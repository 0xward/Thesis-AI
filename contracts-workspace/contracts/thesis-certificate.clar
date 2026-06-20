(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-TOKEN-NOT-FOUND (err u404))
(define-constant ERR-NOT-OWNER (err u402))

(define-non-fungible-token ThesisCertificate uint)

(define-data-var last-token-id uint u0)
(define-data-var contract-owner principal tx-sender)

(define-map token-metadata uint
  { thesis-hash: (buff 32), metadata-uri: (string-ascii 256), minted-at: uint }
)

(define-public (mint (recipient principal) (thesis-hash (buff 32)) (metadata-uri (string-ascii 256)))
  (let ((token-id (+ (var-get last-token-id) u1)))
    (try! (nft-mint? ThesisCertificate token-id recipient))
    (map-set token-metadata token-id
      { thesis-hash: thesis-hash, metadata-uri: metadata-uri, minted-at: stacks-block-height })
    (var-set last-token-id token-id)
    (print { event: "certificate-minted", token-id: token-id, recipient: recipient, thesis-hash: thesis-hash })
    (ok token-id)
  )
)

(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (nft-transfer? ThesisCertificate token-id sender recipient)
  )
)

(define-read-only (get-last-token-id)
  (ok (var-get last-token-id))
)

(define-read-only (get-token-uri (token-id uint))
  (match (map-get? token-metadata token-id)
    meta (ok (some (get metadata-uri meta)))
    ERR-TOKEN-NOT-FOUND
  )
)

(define-read-only (get-owner (token-id uint))
  (ok (nft-get-owner? ThesisCertificate token-id))
)

(define-read-only (get-token-metadata (token-id uint))
  (map-get? token-metadata token-id)
)

(define-public (set-contract-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-AUTHORIZED)
    (var-set contract-owner new-owner)
    (ok true)
  )
)
