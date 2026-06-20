import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

const CONTRACT = "thesis-registry";

// A fixed 32-byte hash for tests (sha256 of "thesis-a")
const HASH_A = "0x" + "a1".repeat(32);
const HASH_B = "0x" + "b2".repeat(32);

describe("thesis-registry", () => {
  it("anchors a new thesis hash and records the sender as owner", () => {
    const result = simnet.callPublicFn(
      CONTRACT,
      "anchor-thesis",
      [Cl.buffer(Buffer.from(HASH_A.slice(2), "hex")), Cl.stringUtf8("My Thesis Title")],
      wallet1
    );
    expect(result.result).toBeOk(Cl.bool(true));

    // Read the block height back from the contract's own print event rather
    // than guessing simnet's block counter timing, which can vary slightly
    // depending on prior setup transactions in a given simnet session.
    const printEvent = result.events.find((e) => e.event === "print_event");
    const anchoredBlock = (printEvent!.data.value as any).value.block.value as bigint;

    const proof = simnet.callReadOnlyFn(
      CONTRACT,
      "get-proof",
      [Cl.buffer(Buffer.from(HASH_A.slice(2), "hex"))],
      wallet1
    );

    expect(proof.result).toBeSome(
      Cl.tuple({
        owner: Cl.principal(wallet1),
        block: Cl.uint(anchoredBlock),
        title: Cl.stringUtf8("My Thesis Title"),
      })
    );
  });

  it("rejects anchoring the same hash twice, even from a different sender", () => {
    simnet.callPublicFn(
      CONTRACT,
      "anchor-thesis",
      [Cl.buffer(Buffer.from(HASH_B.slice(2), "hex")), Cl.stringUtf8("First anchor")],
      wallet1
    );

    // wallet2 tries to anchor the SAME hash — must fail, proving the hash
    // (and therefore authorship claim) cannot be hijacked by anyone else.
    const dup = simnet.callPublicFn(
      CONTRACT,
      "anchor-thesis",
      [Cl.buffer(Buffer.from(HASH_B.slice(2), "hex")), Cl.stringUtf8("Attempted hijack")],
      wallet2
    );

    expect(dup.result).toBeErr(Cl.uint(100)); // ERR-ALREADY-ANCHORED
  });

  it("tracks a running thesis count per owner", () => {
    const before = simnet.callReadOnlyFn(CONTRACT, "get-thesis-count", [Cl.principal(wallet2)], wallet2);
    expect(before.result).toBeUint(0);

    const newHash = "0x" + "c3".repeat(32);
    simnet.callPublicFn(
      CONTRACT,
      "anchor-thesis",
      [Cl.buffer(Buffer.from(newHash.slice(2), "hex")), Cl.stringUtf8("Wallet2's thesis")],
      wallet2
    );

    const after = simnet.callReadOnlyFn(CONTRACT, "get-thesis-count", [Cl.principal(wallet2)], wallet2);
    expect(after.result).toBeUint(1);
  });

  it("returns none for a hash that was never anchored", () => {
    const neverAnchored = "0x" + "ff".repeat(32);
    const proof = simnet.callReadOnlyFn(
      CONTRACT,
      "get-proof",
      [Cl.buffer(Buffer.from(neverAnchored.slice(2), "hex"))],
      deployer
    );
    expect(proof.result).toBeNone();
  });
});
