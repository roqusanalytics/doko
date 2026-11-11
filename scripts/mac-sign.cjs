// electron-builder only signs with identities that `security find-identity -v` lists as trusted, so a self-signed
// certificate is passed here instead (build with -c.mac.identity=- -c.mac.sign=scripts/mac-sign.cjs).
const { signAsync } = require("@electron/osx-sign");

module.exports = (opts) => {
  const identity = process.env.DOKO_MAC_SIGN_IDENTITY; // SHA-1 of the certificate
  const keychain = process.env.DOKO_MAC_SIGN_KEYCHAIN;
  if (!identity || !keychain) throw new Error("DOKO_MAC_SIGN_IDENTITY and DOKO_MAC_SIGN_KEYCHAIN are required");
  return signAsync({ ...opts, identity, keychain, identityValidation: false });
};
