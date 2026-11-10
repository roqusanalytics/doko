// Build outside File Provider folders, whose FinderInfo metadata prevents codesigning.
module.exports = {
  ...require("./package.json").build,
  directories: { output: require("node:path").join(require("node:os").tmpdir(), "doko-local-build") },
};
