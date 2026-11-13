import { KeyPair, keyToImplicitAddress } from "near-api-js";
import { generateEd25519, implicitAccountId } from "../lib/near/read";

const keys = generateEd25519();
console.log("pub_prefix", keys.publicKey.slice(0, 12), "pub_len", keys.publicKey.length);
try {
  const a = implicitAccountId(keys.publicKey);
  console.log("implicitAccountId", a, a.length);
} catch (err) {
  console.log("implicitAccountId err", err instanceof Error ? err.message : err);
}
try {
  const b = keyToImplicitAddress(keys.publicKey);
  console.log("keyToImplicitAddress string", b, typeof b, String(b).length);
} catch (err) {
  console.log("keyToImplicitAddress string err", err instanceof Error ? err.message : err);
}
try {
  const kp = KeyPair.fromRandom("ed25519");
  const c = keyToImplicitAddress(kp.getPublicKey().toString());
  console.log("from KeyPair", c);
} catch (err) {
  console.log("from KeyPair err", err instanceof Error ? err.message : err);
}
