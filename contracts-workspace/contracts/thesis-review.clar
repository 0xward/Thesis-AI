;; thesis-review.clar
;;
;; Peer-review / attestation layer on top of thesis-registry.
;; A reviewer (advisor, peer, examiner) who holds a Stacks wallet can attest
;; to a thesis that is already anchored, leaving a rating + short comment
;; on-chain. This gives ThesisAI "proof of review", not just "proof of
;; authorship" - a natural extension of what thesis-registry already does.
;;
;; Design notes:
;;   - A reviewer cannot review their own anchored thesis (no self-attestation).
;;   - A reviewer can only attest once per hash (no review-stuffing).
;;   - Rating is constrained to 1-5 to keep it meaningful and cheap to store.
;;   - This contract is intentionally separate from thesis-registry and
;;     thesis-certificate-v2 - it only *reads* the registry, never writes to
;;     it, so it cannot affect existing anchored data even if buggy.

(define-constant ERR-HASH-NOT-ANCHORED (err u410))
(define-constant ERR-SELF-REVIEW (err u420))
(define-constant ERR-ALREADY-REVIEWED (err u421))
(define-constant ERR-INVALID-RATING (err u422))

;; NOTE: see same note in thesis-certificate-v2.clar -- contract-call? target
;; must be written literally, not stored in a constant.

;; key: { thesis-hash, reviewer } -> review record
(define-map reviews { thesis-hash: (buff 32), reviewer: principal }
  { rating: uint, comment: (string-utf8 280), block: uint }
)

;; running aggregate per thesis-hash, updated on each new review
(define-map review-stats (buff 32) { total-rating: uint, review-count: uint })

(define-public (submit-review (thesis-hash (buff 32)) (rating uint) (comment (string-utf8 280)))
  (let (
      (proof (unwrap! (contract-call? .thesis-registry get-proof thesis-hash) ERR-HASH-NOT-ANCHORED))
      (stats (default-to { total-rating: u0, review-count: u0 } (map-get? review-stats thesis-hash)))
    )
    (asserts! (and (>= rating u1) (<= rating u5)) ERR-INVALID-RATING)
    (asserts! (not (is-eq tx-sender (get owner proof))) ERR-SELF-REVIEW)
    (asserts! (is-none (map-get? reviews { thesis-hash: thesis-hash, reviewer: tx-sender })) ERR-ALREADY-REVIEWED)

    (map-set reviews { thesis-hash: thesis-hash, reviewer: tx-sender }
      { rating: rating, comment: comment, block: stacks-block-height })
    (map-set review-stats thesis-hash
      { total-rating: (+ (get total-rating stats) rating),
        review-count: (+ (get review-count stats) u1) })

    (print { event: "thesis-reviewed", thesis-hash: thesis-hash, reviewer: tx-sender, rating: rating })
    (ok true)
  )
)

(define-read-only (get-review (thesis-hash (buff 32)) (reviewer principal))
  (map-get? reviews { thesis-hash: thesis-hash, reviewer: reviewer })
)

(define-read-only (get-review-stats (thesis-hash (buff 32)))
  (default-to { total-rating: u0, review-count: u0 } (map-get? review-stats thesis-hash))
)

;; Returns average rating scaled by 100 (e.g. 467 = 4.67) to avoid fractions
;; in Clarity, which has no floating point. Returns 0 if no reviews yet.
(define-read-only (get-average-rating-x100 (thesis-hash (buff 32)))
  (let ((stats (get-review-stats thesis-hash)))
    (if (is-eq (get review-count stats) u0)
      u0
      (/ (* (get total-rating stats) u100) (get review-count stats))
    )
  )
)
