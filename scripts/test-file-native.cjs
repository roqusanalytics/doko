const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createSaveFiles } = require('../electron/save-files.cjs');
const { createContentFiles } = require('../electron/content-files.cjs');
const { fileMenuTemplate } = require('../electron/file-menu.cjs');
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folio-native-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return fs.realpath(root);
}
const request = (extra = {}) => ({ name: 'copy.pdf', format: 'pdf', data: new Uint8Array([1, 2, 3]), ...extra });
test('binary saves need a native choice, preserve capabilities, and refuse external changes', async t => {
  const root = await temporary(t), file = path.join(root, 'copy.pdf');
  let calls = 0;
  const files = createSaveFiles({ chooseSavePath: async () => { calls++; return file; } });
  const first = await files.save(request());
  assert.equal(first.ok, true); assert.ok(first.id); assert.equal(calls, 1);
  assert.deepEqual(await fs.readFile(file), Buffer.from([1, 2, 3]));
  assert.equal((await files.save(request({ id: first.id, data: new Uint8Array([4]) }))).ok, true);
  assert.equal(calls, 1);
  await fs.writeFile(file, 'external');
  assert.deepEqual(await files.save(request({ id: first.id })), { conflict: true });
  assert.equal(await fs.readFile(file, 'utf8'), 'external');
  files.clear(); assert.ok((await files.save(request({ id: first.id }))).error);
  assert.deepEqual((await fs.readdir(root)).filter(name => name.endsWith('.tmp')), []);
});
test('binary validation, cancel, wrong extension, symlink, Save As and write failure', async t => {
  const root = await temporary(t), file = path.join(root, 'copy.pdf');
  let chosen = null, calls = 0;
  const files = createSaveFiles({ chooseSavePath: async () => { calls++; return chosen; } });
  for (const bad of [request({ name: '../copy.pdf' }), request({ data: [] }), request({ data: new Uint8Array() }), request({ format: 'exe' }), request({ id: 'unknown' }), request({ saveAs: 'yes' })]) assert.ok((await files.save(bad)).error);
  assert.equal(calls, 0);
  assert.deepEqual(await files.save(request()), { cancelled: true });
  chosen = path.join(root, 'copy.exe'); assert.ok((await files.save(request())).error);
  chosen = file;
  await fs.writeFile(path.join(root, 'original.pdf'), 'original');
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(root, 'original.pdf'), file);
    assert.ok((await files.save(request())).error);
    assert.equal(await fs.readFile(path.join(root, 'original.pdf'), 'utf8'), 'original');
    await fs.unlink(file);
  }
  const saved = await files.save(request()); assert.equal(saved.ok, true);
  chosen = path.join(root, 'other.pdf');
  const copied = await files.save(request({ id: saved.id, saveAs: true }));
  assert.equal(copied.ok, true); assert.notEqual(copied.id, saved.id);
  chosen = root; assert.ok((await files.save(request())).error);
  chosen = path.join(root, 'absent', 'copy.pdf'); assert.ok((await files.save(request())).error);
});
test('gallery Trash requires membership and confirmation; failure and symlinks preserve files', async t => {
  const root = await temporary(t), file = path.join(root, 'photo.png');
  await fs.writeFile(file, 'image');
  let confirmed = false, fail = false, attempts = 0, revealed;
  const content = createContentFiles({ confirmTrash: async () => confirmed,
    trashItem: async selected => { attempts++; assert.equal(selected, file); if (fail) throw new Error('Trash unavailable'); await fs.unlink(selected); },
    showItemInFolder: selected => { revealed = selected; } });
  const gallery = await content.open(file);
  for (const name of ['../photo.png', 'photo.png/../photo.png', 'missing.png', null]) await assert.rejects(content.trash(gallery.id, name));
  await assert.rejects(content.trash('wrong', 'photo.png'));
  assert.equal(attempts, 0);
  assert.equal(await content.trash(gallery.id, 'photo.png'), null);
  assert.equal(attempts, 0);
  assert.equal(await content.reveal(gallery.id, 'photo.png'), true); assert.equal(revealed, file);
  confirmed = true; fail = true;
  await assert.rejects(content.trash(gallery.id, 'photo.png'), /Trash unavailable/);
  assert.equal(await fs.readFile(file, 'utf8'), 'image');
  fail = false;
  if (process.platform !== 'win32') {
    await fs.rename(file, path.join(root, 'target.png'));
    await fs.symlink(path.join(root, 'target.png'), file);
    await assert.rejects(content.trash(gallery.id, 'photo.png'));
    await assert.rejects(content.reveal(gallery.id, 'photo.png'));
    await fs.unlink(file); await fs.rename(path.join(root, 'target.png'), file);
  }
  const updated = await content.trash(gallery.id, 'photo.png');
  assert.deepEqual(updated.files, []); assert.equal(updated.selected, '');
});
test('gallery file/root replacement during confirmation cannot be trashed', async t => {
  const root = await temporary(t), folder = path.join(root, 'gallery'); await fs.mkdir(folder);
  const file = path.join(folder, 'photo.png'); await fs.writeFile(file, 'old');
  let trashCalls = 0;
  const content = createContentFiles({ confirmTrash: async () => { await fs.rename(folder, path.join(root, 'old')); await fs.mkdir(folder); await fs.writeFile(file, 'replacement'); return true; }, trashItem: async () => trashCalls++ });
  const gallery = await content.open(file);
  await assert.rejects(content.trash(gallery.id, 'photo.png'), /folder changed/);
  assert.equal(trashCalls, 0); assert.equal(await fs.readFile(file, 'utf8'), 'replacement');
});
test('gallery permission recovery accepts only the same unchanged image and retries once', async t => {
  for (const scenario of ['cancel', 'wrong file', 'same file', 'replaced', 'changed', 'metadata only', 'repeated denial']) {
    await t.test(scenario, async t => {
      const root = await temporary(t), file = path.join(root, 'photo.png'), other = path.join(root, 'other.png');
      await fs.writeFile(file, 'image'); await fs.writeFile(other, 'other');
      let attempts = 0, prompts = 0;
      const content = createContentFiles({ confirmTrash: async () => true,
        trashItem: async selected => {
          assert.equal(selected, file); attempts++;
          if (attempts === 1 || scenario === 'repeated denial') throw Object.assign(new Error('denied'), { code: 'EACCES' });
          await fs.unlink(selected);
        },
        requestTrashAccess: async selected => {
          prompts++; assert.equal(selected, file);
          if (scenario === 'cancel') return null;
          if (scenario === 'wrong file') return other;
          if (scenario === 'replaced') { await fs.rename(file, path.join(root, 'original.png')); await fs.writeFile(file, 'image'); }
          if (scenario === 'changed') {
            const stat = await fs.stat(file);
            await fs.writeFile(file, 'other'); await fs.utimes(file, stat.atime, stat.mtime);
          }
          if (scenario === 'metadata only') await fs.utimes(file, new Date(0), new Date(0));
          return file;
        } });
      const gallery = await content.open(file);
      if (scenario === 'cancel') assert.equal(await content.trash(gallery.id, 'photo.png'), null);
      else if (scenario === 'wrong file') await assert.rejects(content.trash(gallery.id, 'photo.png'), /same image/);
      else if (['replaced', 'changed'].includes(scenario)) await assert.rejects(content.trash(gallery.id, 'photo.png'), /image changed/);
      else if (scenario === 'repeated denial') await assert.rejects(content.trash(gallery.id, 'photo.png'), /Still couldn't move.*Show in folder/);
      else assert.deepEqual((await content.trash(gallery.id, 'photo.png')).files, ['other.png']);
      assert.equal(prompts, 1);
      assert.equal(attempts, ['same file', 'metadata only', 'repeated denial'].includes(scenario) ? 2 : 1);
      assert.equal(await fs.readFile(other, 'utf8'), 'other');
      if (!['same file', 'metadata only'].includes(scenario)) assert.equal(await fs.readFile(file, 'utf8'), scenario === 'changed' ? 'other' : 'image');
    });
  }
});
test('gallery changes during a failed Trash attempt cannot become the permission snapshot', async t => {
  const root = await temporary(t), file = path.join(root, 'photo.png'); await fs.writeFile(file, 'image');
  let prompts = 0, attempts = 0;
  const content = createContentFiles({ confirmTrash: async () => true,
    trashItem: async () => { attempts++; await fs.writeFile(file, 'other'); throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    requestTrashAccess: async () => { prompts++; return file; } });
  const gallery = await content.open(file);
  await assert.rejects(content.trash(gallery.id, 'photo.png'), /image changed/);
  assert.equal(attempts, 1); assert.equal(prompts, 0);
  assert.equal(await fs.readFile(file, 'utf8'), 'other');
});
test('gallery access recovery recognizes native permission errors without prompting for unrelated failures', async t => {
  for (const error of [Object.assign(new Error('denied'), { code: 'EPERM' }), new Error('You do not have permission'), new Error('Operation not permitted'), new Error('Access denied'), new Error('Trash unavailable')]) {
    const root = await temporary(t), file = path.join(root, 'photo.png'); await fs.writeFile(file, 'image');
    let attempts = 0, prompts = 0;
    const content = createContentFiles({ confirmTrash: async () => true, trashItem: async () => { attempts++; throw error; },
      requestTrashAccess: async () => { prompts++; return null; } });
    const gallery = await content.open(file);
    if (error.message === 'Trash unavailable') await assert.rejects(content.trash(gallery.id, 'photo.png'), /Trash unavailable/);
    else assert.equal(await content.trash(gallery.id, 'photo.png'), null);
    assert.equal(attempts, 1); assert.equal(prompts, error.message === 'Trash unavailable' ? 0 : 1);
    assert.equal(await fs.readFile(file, 'utf8'), 'image');
  }
});
test('native menus dispatch commands and enable only applicable actions on every platform', () => {
  for (const platform of ['darwin', 'win32', 'linux']) {
    const events = []; let opens = 0;
    const build = state => fileMenuTemplate({ platform, state, send: (...args) => events.push(args), open: () => opens++ });
    const template = build({ kind: 'pdf', busy: false }), menu = template.find(item => item.label === 'File').submenu;
    for (const label of ['Save', 'Save As…', 'Export / Convert…', 'Reduce File Size…', 'Print…', 'Properties…']) assert.equal(menu.find(item => item.label === label).enabled, true);
    menu.find(item => item.label === 'Save').click(); assert.deepEqual(events.pop(), ['folio:file-command', 'save']);
    menu.find(item => item.label === 'New Tab').click(); assert.deepEqual(events.pop(), ['folio:tab-command', 'new']);
    menu.find(item => item.label === 'Open…').click(); assert.equal(opens, 1);
    assert.ok(template.some(item => item.role === 'editMenu')); assert.ok(template.some(item => item.role === 'windowMenu'));
    for (const state of [{ kind: 'none', busy: false }, { kind: 'pdf', busy: true }]) {
      const disabled = build(state).find(item => item.label === 'File').submenu;
      assert.equal(disabled.find(item => item.label === 'Save').enabled, false);
      assert.equal(disabled.find(item => item.label === 'Open Recent…').enabled, true);
    }
    assert.equal(build({ kind: 'markdown', busy: false }).find(item => item.label === 'File').submenu.find(item => item.label === 'Reduce File Size…').enabled, false);
  }
});

test('empty text exports are valid documents', async t => {
  const root = await temporary(t), file = path.join(root, 'empty.txt');
  const files = createSaveFiles({ chooseSavePath: async () => file });
  assert.equal((await files.save(request({ name: 'empty.txt', format: 'txt', data: new Uint8Array() }))).ok, true);
  assert.equal((await fs.stat(file)).size, 0);
});

test('new saves work without hard links and never overwrite a racing destination', async t => {
  const root = await temporary(t), file = path.join(root, 'copy.pdf');
  const files = createSaveFiles({ chooseSavePath: async () => file });
  const link = fs.link;
  try {
    fs.link = async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); };
    assert.equal((await files.save(request())).ok, true);
    assert.deepEqual(await fs.readFile(file), Buffer.from([1, 2, 3]));
    await fs.unlink(file);
    fs.link = async () => { await fs.writeFile(file, 'external'); throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); };
    assert.ok((await files.save(request())).error);
    assert.equal(await fs.readFile(file, 'utf8'), 'external');
  } finally { fs.link = link; }
});

test('macOS replacement keeps file ACLs and excludes the staging folder ACL', { skip: process.platform !== 'darwin' }, async t => {
  const { execFileSync } = require('node:child_process');
  const acl = file => execFileSync('/bin/ls', ['-ldebn', file], { encoding: 'utf8' }).split('\n').slice(1).join('\n');
  const root = await temporary(t);
  execFileSync('/bin/chmod', ['+a', 'user:nobody allow read,file_inherit,directory_inherit', root]);
  for (const markdown of [false, true]) {
    for (const restricted of [false, true]) {
      const file = path.join(root, `${markdown}-${restricted}.${markdown ? 'md' : 'pdf'}`);
      await fs.writeFile(file, 'original', { mode: 0o644 });
      execFileSync('/bin/chmod', ['-N', file]);
      if (restricted) execFileSync('/bin/chmod', ['+a', 'user:nobody deny read', file]);
      const before = await fs.stat(file), access = acl(file);
      if (markdown) {
        const content = createContentFiles(); const opened = await content.open(file);
        assert.equal((await content.save(opened.id, 'changed')).ok, true);
      } else {
        const files = createSaveFiles({ chooseSavePath: async () => file });
        assert.equal((await files.save(request())).ok, true);
      }
      const after = await fs.stat(file);
      assert.equal(acl(file), access, 'preserve exact file ACL, without inherited grants');
      assert.equal(after.mode & 0o777, 0o644);
      assert.equal(after.uid, before.uid); assert.equal(after.gid, before.gid);
      assert.notEqual(after.ino, before.ino, 'replacement remains atomic, not an in-place write');
    }
  }
  const newFile = path.join(root, 'private.pdf');
  assert.equal((await createSaveFiles({ chooseSavePath: async () => newFile }).save(request())).ok, true);
  assert.equal((await fs.stat(newFile)).mode & 0o777, 0o600);
  assert.equal(acl(newFile), '', 'new saves do not inherit grants that bypass mode 0600');
  const fallback = path.join(root, 'fallback.pdf'), link = fs.link;
  try {
    fs.link = async () => { throw Object.assign(new Error('unsupported'), { code: 'ENOTSUP' }); };
    assert.equal((await createSaveFiles({ chooseSavePath: async () => fallback }).save(request())).ok, true);
    assert.equal(acl(fallback), '', 'copy fallback removes inherited grants before writing');
    assert.equal((await fs.stat(fallback)).mode & 0o777, 0o600);
  } finally { fs.link = link; }
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.folio-')), false);
});

test('permission preservation errors keep originals and clean up staging files', async t => {
  const root = await temporary(t), file = path.join(root, 'original.pdf');
  await fs.writeFile(file, 'original');
  const mkdir = fs.mkdtemp;
  fs.mkdtemp = async () => { throw new Error('Cannot prepare permissions'); };
  try {
    const result = await createSaveFiles({ chooseSavePath: async () => file }).save(request());
    assert.match(result.error, /access permissions.*Save As/);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    const markdown = path.join(root, 'original.md'); await fs.writeFile(markdown, 'markdown');
    const content = createContentFiles(); const opened = await content.open(markdown);
    assert.match((await content.save(opened.id, 'changed')).error, /access permissions.*Save As/);
    assert.equal(await fs.readFile(markdown, 'utf8'), 'markdown');
  } finally { fs.mkdtemp = mkdir; }
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.folio-')), false);
});

test('metadata helpers use native preservation and fail closed on unsupported tools or ownership', async () => {
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(__dirname, '../electron/save-metadata.cjs'), 'utf8');
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const failure of [null, 'command', 'ownership']) {
      if (platform === 'win32' && failure === 'ownership') continue;
      const commands = [], removed = [], stat = { uid: 12n, gid: 34n, mode: 0o100640n };
      let closed = false;
      const handle = { close: async () => { closed = true; }, truncate: async () => {},
        stat: async () => ({ ...stat, uid: failure === 'ownership' ? 99n : stat.uid }) };
      const fakeFs = { mkdtemp: async () => '/folder/.folio-private', chmod: async () => {}, open: async () => handle,
        rm: async folder => removed.push(folder) };
      const loaded = { exports: {} };
      vm.runInNewContext(source, { module: loaded, process: { platform, env: {} }, require: name => {
        if (name === 'node:fs/promises') return fakeFs;
        if (name === './windows-powershell.cjs') return { systemPowerShell: () => 'system-powershell.exe' };
        if (name === 'node:child_process') return { execFile: (program, args, options, done) => {
          commands.push({ program, args, options });
          done(failure === 'command' ? new Error('unsupported') : null, '', '');
        } };
        return require(name);
      } });
      if (failure) {
        await assert.rejects(loaded.exports.createSaveTemp('/folder', { file: '/folder/source', stat }), /access permissions.*Save As/);
        assert.equal(closed, !(platform === 'darwin' && failure === 'command'));
        assert.deepEqual(removed, ['/folder/.folio-private']);
      } else {
        const pending = await loaded.exports.createSaveTemp('/folder', { file: '/folder/source', stat });
        await pending.verify(); await handle.close(); await pending.cleanup();
        if (platform === 'linux') assert.deepEqual(Array.from(commands[0].args), ['--attributes-only', '--preserve=mode,ownership', '--', '/folder/source', '/folder/.folio-private/save.tmp']);
        if (platform === 'darwin') assert.equal(commands.find(command => command.program === '/bin/cp').args[0], '-pX');
        if (platform === 'win32') {
          assert.equal(commands[0].options.env.FOLIO_SAVE_SOURCE, '/folder/source');
          assert.equal(commands[0].args.at(-1).includes('/folder/source'), false, 'paths are data, never PowerShell source');
          assert.match(commands[0].args.at(-1), /GetSecurityDescriptorSddlForm/);
          assert.match(commands[0].args.at(-1), /ErrorActionPreference = 'Stop'/);
        }
      }
    }
  }
});

test('Windows saves preserve inherited and protected DACLs and refuse unsupported integrity labels', { skip: process.platform !== 'win32' }, async t => {
  const { execFileSync } = require('node:child_process');
  const { systemPowerShell } = require('../electron/windows-powershell.cjs');
  const root = await temporary(t);
  const powershell = (script, file) => execFileSync(systemPowerShell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $env:PSModulePath=\"$PSHOME\\Modules\";" + script], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, FOLIO_TEST_FILE: file },
  }).trim();
  const access = file => powershell('(Get-Acl -LiteralPath $env:FOLIO_TEST_FILE).Sddl', file);
  for (const markdown of [false, true]) {
    const inherited = path.join(root, markdown ? 'inherited.md' : 'inherited.pdf'); await fs.writeFile(inherited, 'original');
    const inheritedAccess = () => powershell('Get-Acl -LiteralPath $env:FOLIO_TEST_FILE | Select-Object Owner,Group,AreAccessRulesProtected,AccessToString | ConvertTo-Json -Compress', inherited);
    const inheritedBefore = inheritedAccess();
    const inheritedContent = markdown ? createContentFiles() : createSaveFiles({ chooseSavePath: async () => inherited });
    const inheritedOpened = markdown ? await inheritedContent.open(inherited) : null;
    assert.equal((markdown ? await inheritedContent.save(inheritedOpened.id, 'changed') : await inheritedContent.save(request())).ok, true);
    assert.equal(inheritedAccess(), inheritedBefore, 'preserve owner, group, all inherited access rules, and inheritance protection');
    const file = path.join(root, markdown ? 'notes.md' : 'copy.pdf'); await fs.writeFile(file, 'original');
    powershell("$acl=Get-Acl -LiteralPath $env:FOLIO_TEST_FILE; $acl.SetAccessRuleProtection($true,$true); $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-32-546'),'ReadData','Deny')); Set-Acl -LiteralPath $env:FOLIO_TEST_FILE -AclObject $acl", file);
    const before = access(file);
    const content = markdown ? createContentFiles() : createSaveFiles({ chooseSavePath: async () => file });
    const opened = markdown ? await content.open(file) : null;
    const save = () => markdown ? content.save(opened.id, 'changed') : content.save(request());
    assert.equal((await save()).ok, true); assert.equal(access(file), before);
    powershell('& "$([Environment]::SystemDirectory)\\icacls.exe" $env:FOLIO_TEST_FILE /setintegritylevel L | Out-Null; if ($LASTEXITCODE -ne 0) { throw "Cannot set test integrity label" }', file);
    if (markdown) await content.reload(opened.id);
    const bytes = await fs.readFile(file), labelled = access(file);
    assert.match((await save()).error, /access permissions.*Save As/);
    assert.deepEqual(await fs.readFile(file), bytes); assert.equal(access(file), labelled);
  }
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.folio-')), false);
});

test('Linux saves preserve POSIX ACL entries', { skip: process.platform !== 'linux' }, async t => {
  const { execFileSync } = require('node:child_process');
  try { execFileSync('setfacl', ['--version']); execFileSync('getfacl', ['--version']); }
  catch { t.skip('POSIX ACL fixture utilities unavailable; native command failure remains covered by mocks'); return; }
  const root = await temporary(t);
  const access = file => execFileSync('getfacl', ['-cpn', '--', file], { encoding: 'utf8' });
  for (const markdown of [false, true]) {
    const file = path.join(root, markdown ? 'notes.md' : 'copy.pdf'); await fs.writeFile(file, 'original', { mode: 0o644 });
    execFileSync('setfacl', ['-m', 'u:65534:---', '--', file]);
    const before = access(file);
    if (markdown) {
      const content = createContentFiles(); const opened = await content.open(file);
      assert.equal((await content.save(opened.id, 'changed')).ok, true);
    } else assert.equal((await createSaveFiles({ chooseSavePath: async () => file }).save(request())).ok, true);
    assert.equal(access(file), before);
  }
});

test('failed copy fallback preserves a concurrently replaced destination', async t => {
  const root = await temporary(t), open = fs.open, link = fs.link;
  for (const failure of ['writeFile', 'sync']) {
    const file = path.join(root, `${failure}.pdf`);
    fs.link = async () => { throw Object.assign(new Error('No hard links'), { code: 'ENOTSUP' }); };
    fs.open = async (...args) => {
      const handle = await open(...args);
      if (args[0] === file && args[1] === 'wx') {
        const operation = handle[failure].bind(handle);
        handle[failure] = async (...values) => {
          await operation(...values);
          await fs.rename(file, `${file}.moved`);
          await fs.writeFile(file, 'external replacement');
          throw Object.assign(new Error('Write failed'), { code: 'EIO' });
        };
      }
      return handle;
    };
    try {
      const result = await createSaveFiles({ chooseSavePath: async () => file }).save(request());
      assert.match(result.error, /Check the destination file.*Save As/);
      assert.equal(result.ok, undefined);
      assert.equal(await fs.readFile(file, 'utf8'), 'external replacement');
    } finally { fs.open = open; fs.link = link; }
  }
  assert.equal((await fs.readdir(root)).some(name => name.startsWith('.folio-')), false);
});
