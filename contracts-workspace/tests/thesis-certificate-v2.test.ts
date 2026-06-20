import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const author = accounts.get("wallet_1")!;
const attacker = accounts.get("wallet_3")!;
const victim = accounts.get("wallet_4")!;

const REGISTRY = "thesis-registry";
const V2 = "thesis-certificate-v2";

const HASH = "0x" + "33".repeat(32);
const hashBuf = () => Cl.buffer(Buffer.from(HASH.slice(2), "hex"));

function anchorAs(who: string, hash = HASH, title = "A real thesis") {
  return simnet.callPublicFn(
    REGISTRY,
    "anchor-thesis",
    [Cl.buffer(Buffer.from(hash.slice(2), "hex")), Cl.stringUtf8(title)],
    who
  );
}

describe("thesis-certificate-v2 — fixes the v1 access-control bug", () => {
  it("[FIX CONFIRMED] rejects mint from a non-owner caller, even with a valid anchored hash", () => {
    anchorAs(author);

    // deployer == contract-owner by default in v2. `attacker` is NOT the
    // owner, so even though the hash is validly anchored to `author`,
    // attacker still cannot mint — this is the access-control fix.
    const mint = simnet.callPublicFn(
      V2,
      "mint",
      [Cl.principal(author), hashBuf(), Cl.stringAscii("ipfs://real-metadata")],
      attacker
    );

    expect(mint.result).toBeErr(Cl.uint(401)); // ERR-NOT-AUTHORIZED
  });

  it("[FIX CONFIRMED] rejects mint for a hash that was never anchored", () => {
    const neverAnchored = Cl.buffer(Buffer.from(("0x" + "99".repeat(32)).slice(2), "hex"));
    const mint = simnet.callPublicFn(
      V2,
      "mint",
      [Cl.principal(victim), neverAnchored, Cl.stringAscii("ipfs://x")],
      deployer
    );
    expect(mint.result).toBeErr(Cl.uint(410)); // ERR-HASH-NOT-ANCHORED
  });

  it("[FIX CONFIRMED] rejects mint when recipient does not match the hash's anchored owner (no impersonation)", () => {
    anchorAs(author);

    // deployer (owner) tries to mint the certificate to `victim` instead of
    // `author`, who actually anchored the hash. Must fail.
    const mint = simnet.callPublicFn(
      V2,
      "mint",
      [Cl.principal(victim), hashBuf(), Cl.stringAscii("ipfs://x")],
      deployer
    );
    expect(mint.result).toBeErr(Cl.uint(411)); // ERR-NOT-HASH-OWNER
  });

  it("mints successfully when caller is owner, hash is anchored, and recipient matches the anchorer", () => {
    anchorAs(author);

    const mint = simnet.callPublicFn(
      V2,
      "mint",
      [Cl.principal(author), hashBuf(), Cl.stringAscii("ipfs://real-metadata")],
      deployer
    );
    expect(mint.result).toBeOk(Cl.uint(1));

    const owner = simnet.callReadOnlyFn(V2, "get-owner", [Cl.uint(1)], deployer);
    expect(owner.result).toBeOk(Cl.some(Cl.principal(author)));

    const tokenUri = simnet.callReadOnlyFn(V2, "get-token-uri", [Cl.uint(1)], deployer);
    expect(tokenUri.result).toBeOk(Cl.some(Cl.stringAscii("ipfs://real-metadata")));
  });

  it("rejects minting a second certificate for the same thesis hash (no duplicate certs)", () => {
    anchorAs(author);
    simnet.callPublicFn(V2, "mint", [Cl.principal(author), hashBuf(), Cl.stringAscii("ipfs://x")], deployer);

    const secondMint = simnet.callPublicFn(
      V2,
      "mint",
      [Cl.principal(author), hashBuf(), Cl.stringAscii("ipfs://y")],
      deployer
    );
    expect(secondMint.result).toBeErr(Cl.uint(412)); // ERR-ALREADY-CERTIFIED
  });

  it("allows the contract owner to transfer ownership, and the new owner gains mint rights", () => {
    const transferOwnership = simnet.callPublicFn(V2, "set-contract-owner", [Cl.principal(author)], deployer);
    expect(transferOwnership.result).toBeOk(Cl.bool(true));

    anchorAs(victim, HASH, "Victim's own thesis");

    // `author` is now the owner (after transfer) and can mint for victim's
    // own anchored hash.
    const mint = simnet.callPublicFn(
      V2,
      "mint",
      [Cl.principal(victim), hashBuf(), Cl.stringAscii("ipfs://z")],
      author
    );
    expect(mint.result).toBeOk(Cl.uint(1));

    // deployer (old owner) can no longer mint.
    const oldOwnerTry = simnet.callPublicFn(V2, "set-contract-owner", [Cl.principal(deployer)], deployer);
    expect(oldOwnerTry.result).toBeErr(Cl.uint(401));
  });
});
