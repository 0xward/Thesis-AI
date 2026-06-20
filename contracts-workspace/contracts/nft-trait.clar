;; Local mirror of the official SIP-009 nft-trait, identical in content to
;; SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait.nft-trait on mainnet.
;;
;; This file exists ONLY so contracts can be tested locally without needing
;; network access to fetch the mainnet trait contract (e.g. in CI or sandboxed
;; environments). On a machine with normal internet access (like Termux),
;; `clarinet requirements add SP2PABAF9FTAJYNFZH93XENAJ8FVY99RRM50D2JG9.nft-trait`
;; works directly and this local file is not needed - both resolve to the
;; exact same trait definition either way.

(define-trait nft-trait
  (
    (get-last-token-id () (response uint uint))
    (get-token-uri (uint) (response (optional (string-ascii 256)) uint))
    (get-owner (uint) (response (optional principal) uint))
    (transfer (uint principal principal) (response bool uint))
  )
)
