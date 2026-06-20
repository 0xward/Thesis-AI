import { describe, expect, it } from "vitest";
import { Cl } from "@stacks/transactions";

const accounts = simnet.getAccounts();
const author = accounts.get("wallet_1")!;
const reviewer1 = accounts.get("wallet_2")!;
const reviewer2 = accounts.get("wallet_3")!;

const REGISTRY = "thesis-registry";
const REVIEW = "thesis-review";

const HASH = "0x" + "44".repeat(32);
const hashBuf = () => Cl.buffer(Buffer.from(HASH.slice(2), "hex"));

function anchorAsAuthor() {
  return simnet.callPublicFn(
    REGISTRY,
    "anchor-thesis",
    [hashBuf(), Cl.stringUtf8("A thesis worth reviewing")],
    author
  );
}

describe("thesis-review", () => {
  it("rejects a review for a hash that was never anchored", () => {
    const review = simnet.callPublicFn(
      REVIEW,
      "submit-review",
      [hashBuf(), Cl.uint(5), Cl.stringUtf8("Great work")],
      reviewer1
    );
    expect(review.result).toBeErr(Cl.uint(410)); // ERR-HASH-NOT-ANCHORED
  });

  it("accepts a valid review and updates the aggregate stats", () => {
    anchorAsAuthor();

    const review = simnet.callPublicFn(
      REVIEW,
      "submit-review",
      [hashBuf(), Cl.uint(4), Cl.stringUtf8("Solid methodology, needs more citations.")],
      reviewer1
    );
    expect(review.result).toBeOk(Cl.bool(true));

    const stats = simnet.callReadOnlyFn(REVIEW, "get-review-stats", [hashBuf()], reviewer1);
    expect(stats.result).toBeTuple({
      "total-rating": Cl.uint(4),
      "review-count": Cl.uint(1),
    });
  });

  it("rejects a rating outside the 1-5 range", () => {
    anchorAsAuthor();
    const tooHigh = simnet.callPublicFn(
      REVIEW,
      "submit-review",
      [hashBuf(), Cl.uint(6), Cl.stringUtf8("x")],
      reviewer1
    );
    expect(tooHigh.result).toBeErr(Cl.uint(422)); // ERR-INVALID-RATING

    const tooLow = simnet.callPublicFn(
      REVIEW,
      "submit-review",
      [hashBuf(), Cl.uint(0), Cl.stringUtf8("x")],
      reviewer1
    );
    expect(tooLow.result).toBeErr(Cl.uint(422));
  });

  it("rejects self-review (author cannot review their own anchored thesis)", () => {
    anchorAsAuthor();
    const selfReview = simnet.callPublicFn(
      REVIEW,
      "submit-review",
      [hashBuf(), Cl.uint(5), Cl.stringUtf8("My own work is great")],
      author
    );
    expect(selfReview.result).toBeErr(Cl.uint(420)); // ERR-SELF-REVIEW
  });

  it("rejects a second review from the same reviewer on the same hash", () => {
    anchorAsAuthor();
    simnet.callPublicFn(REVIEW, "submit-review", [hashBuf(), Cl.uint(3), Cl.stringUtf8("First pass")], reviewer1);

    const secondAttempt = simnet.callPublicFn(
      REVIEW,
      "submit-review",
      [hashBuf(), Cl.uint(5), Cl.stringUtf8("Trying to review again")],
      reviewer1
    );
    expect(secondAttempt.result).toBeErr(Cl.uint(421)); // ERR-ALREADY-REVIEWED
  });

  it("computes a correct average rating across multiple reviewers", () => {
    anchorAsAuthor();
    simnet.callPublicFn(REVIEW, "submit-review", [hashBuf(), Cl.uint(4), Cl.stringUtf8("Good")], reviewer1);
    simnet.callPublicFn(REVIEW, "submit-review", [hashBuf(), Cl.uint(5), Cl.stringUtf8("Excellent")], reviewer2);

    // average = (4 + 5) / 2 = 4.5 -> represented as 450 (x100 scaling, no floats in Clarity)
    const avg = simnet.callReadOnlyFn(REVIEW, "get-average-rating-x100", [hashBuf()], reviewer1);
    expect(avg.result).toBeUint(450);
  });

  it("returns 0 average rating when there are no reviews yet", () => {
    const avg = simnet.callReadOnlyFn(
      REVIEW,
      "get-average-rating-x100",
      [Cl.buffer(Buffer.from(("0x" + "55".repeat(32)).slice(2), "hex"))],
      reviewer1
    );
    expect(avg.result).toBeUint(0);
  });
});
