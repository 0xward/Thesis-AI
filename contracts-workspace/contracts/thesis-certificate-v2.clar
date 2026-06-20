;; thesis-certificate-v2.clar
;;
;; Fixes a critical access-control gap in thesis-certificate.clar (v1):
;; v1's `mint` had no caller restriction - *anyone* could mint a certificate
;; to *any* recipient for *any* hash, with no proof the hash was ever anchored.
;;
;; v2 closes that gap with two independent checks:
;;   1. Only the contract owner (deployer, or whoever owner transfers to) may
;;      call `mint` - same pattern already used by `set-contract-owner` in v1,
;;      just actually wired up to `mint` this time.
;;   2. The thesis hash must already exist in `thesis-registry`, and the
;;      `recipient` must be the same principal who anchored it. This means a
;;      certificate can only ever be issued to the address that anchored the
;;      thesis hash in the first place - no impersonation possible.
;;
;; v1 (thesis-certificate.clar) is left untouched and still live on mainnet;
;; this is a new, separate contract. Existing v1 token IDs/holders are
;; unaffected. New mints should point to v2 going forward.

(impl-trait 'SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait)

;; ---- Errors ----
(define-constant ERR-NOT-AUTHORIZED (err u401))
(define-constant ERR-TOKEN-NOT-FOUND (err u404))
(define-constant ERR-NOT-OWNER (err u402))
(define-constant ERR-HASH-NOT-ANCHORED (err u410))
(define-constant ERR-NOT-HASH-OWNER (err u411))
(define-constant ERR-ALREADY-CERTIFIED (err u412))

;; NOTE: Clarity's `contract-call?` requires the contract name to be written
;; literally at the call site -- it cannot be passed through a constant or
;; variable. The dependency is still declared via Clarinet.toml's
;; `depends_on`, and the deployed address must match the actual
;; thesis-registry deployment.

(define-non-fungible-token ThesisCertificateV2 uint)

(define-data-var last-token-id uint u0)
(define-data-var contract-owner principal tx-sender)

(define-map token-metadata uint
  { thesis-hash: (buff 32), metadata-uri: (string-ascii 256), minted-at: uint }
)

;; Prevents minting more than one certificate per thesis hash.
(define-map certified-hashes (buff 32) uint)

;; ---- Mint ----
;; Only callable by the contract owner, AND only for a hash that is already
;; anchored in thesis-registry under the exact `recipient` supplied.
;; This means: a user must anchor their thesis first (proving authorship of
;; the hash on-chain), and only then can a certificate be issued to them.
(define-public (mint (recipient principal) (thesis-hash (buff 32)) (metadata-uri (string-ascii 256)))
  (let (
      (token-id (+ (var-get last-token-id) u1))
      (proof (unwrap! (contract-call? .thesis-registry get-proof thesis-hash) ERR-HASH-NOT-ANCHORED))
    )
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-AUTHORIZED)
    (asserts! (is-eq (get owner proof) recipient) ERR-NOT-HASH-OWNER)
    (asserts! (is-none (map-get? certified-hashes thesis-hash)) ERR-ALREADY-CERTIFIED)

    (try! (nft-mint? ThesisCertificateV2 token-id recipient))
    (map-set token-metadata token-id
      { thesis-hash: thesis-hash, metadata-uri: metadata-uri, minted-at: stacks-block-height })
    (map-set certified-hashes thesis-hash token-id)
    (var-set last-token-id token-id)
    (print { event: "certificate-minted-v2", token-id: token-id, recipient: recipient, thesis-hash: thesis-hash })
    (ok token-id)
  )
)

;; ---- Transfer (SIP-009 required) ----
(define-public (transfer (token-id uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (nft-transfer? ThesisCertificateV2 token-id sender recipient)
  )
)

;; ---- Read-only (SIP-009 required) ----
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
  (ok (nft-get-owner? ThesisCertificateV2 token-id))
)

;; ---- Read-only (extra helpers) ----
(define-read-only (get-token-metadata (token-id uint))
  (map-get? token-metadata token-id)
)

(define-read-only (get-certificate-for-hash (thesis-hash (buff 32)))
  (map-get? certified-hashes thesis-hash)
)

(define-read-only (get-contract-owner)
  (var-get contract-owner)
)

;; ---- Ownership management ----
(define-public (set-contract-owner (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) ERR-NOT-AUTHORIZED)
    (var-set contract-owner new-owner)
    (ok true)
  )
)
