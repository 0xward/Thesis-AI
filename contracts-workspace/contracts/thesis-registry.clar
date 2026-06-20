(define-constant ERR-ALREADY-ANCHORED (err u100))
(define-constant ERR-INVALID-HASH (err u101))

(define-map thesis-proofs
  (buff 32)
  { owner: principal, block: uint, title: (string-utf8 200) }
)

(define-map owner-count principal uint)

(define-public (anchor-thesis (hash (buff 32)) (title (string-utf8 200)))
  (begin
    (asserts! (is-none (map-get? thesis-proofs hash)) ERR-ALREADY-ANCHORED)
    (map-set thesis-proofs hash { owner: tx-sender, block: stacks-block-height, title: title })
    (map-set owner-count tx-sender
      (+ (default-to u0 (map-get? owner-count tx-sender)) u1))
    (print { event: "thesis-anchored", hash: hash, owner: tx-sender, block: stacks-block-height })
    (ok true)
  )
)

(define-read-only (get-proof (hash (buff 32)))
  (map-get? thesis-proofs hash)
)

(define-read-only (get-thesis-count (owner principal))
  (default-to u0 (map-get? owner-count owner))
)
