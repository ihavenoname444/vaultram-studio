# Contract build proof

Verified on 2026-10-15. A temporary free [Binder](https://mybinder.org/) Linux x86_64 session built the public runtime source using the [official Antelope CDT 4.1.1 package](https://github.com/AntelopeIO/cdt/releases/tag/v4.1.1). No private keys, environment files or database were uploaded. The session is disposable; downloaded artifacts do not depend on keeping it running.

The Binder environment was `binder-examples/requirements` at commit `505a59f0430cb6414a4acbdd88803ce33c7fd953`. The compiler reported `cdt-cpp version 4.1.1`. Two separate output directories produced byte-identical WASM and ABI. This is a repeated build in one environment, not a claim of independent builder attestation.

| File                           | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| Official CDT .deb              | `d946e6b64f297442d19e486401aa49f956080b07a1fa6335f29976106175b588` |
| runtime.cpp                    | `e1903d6aea1a0b07c24b0224269e9ee1750c825c24908576825304ca6397c235` |
| runtime.wasm (33,024 bytes)    | `3955ec66ff5b9ec1742062b53137ba3f999cdb90b7e6b1d95da222e2598eb054` |
| runtime.abi JSON (6,381 bytes) | `a35f7c60a8ef7814ab4fbfdcc16cd970a5e180027d18b921712683bc5f17abd6` |

The ABI checksum above covers the JSON file. The gateway's ABI pin covers serialized binary ABI; these are different hashes by design. Compilation emitted missing-Ricardian documentation warnings; those are not runtime test failures.

## Reproduce without GitHub Actions

On a disposable Linux x86_64 environment with `curl`, `sha256sum` and `dpkg-deb`, place only the public `runtime.cpp` in the current directory:

```sh
curl --fail --location --output cdt.deb https://github.com/AntelopeIO/cdt/releases/download/v4.1.1/cdt_4.1.1-1_amd64.deb
echo 'd946e6b64f297442d19e486401aa49f956080b07a1fa6335f29976106175b588  cdt.deb' | sha256sum --check --strict
dpkg-deb -x cdt.deb cdt
./cdt/usr/opt/cdt/4.1.1/bin/cdt-cpp --version
mkdir -p run1 run2
./cdt/usr/opt/cdt/4.1.1/bin/cdt-cpp -abigen -contract=vaultram -o run1/runtime.wasm runtime.cpp
./cdt/usr/opt/cdt/4.1.1/bin/cdt-cpp -abigen -contract=vaultram -o run2/runtime.wasm runtime.cpp
cmp run1/runtime.wasm run2/runtime.wasm
cmp run1/runtime.abi run2/runtime.abi
sha256sum runtime.cpp run1/runtime.wasm run1/runtime.abi
```

Download the two artifacts into `contracts/build/` in the local repository, then run:

```sh
pnpm install --frozen-lockfile
REQUIRE_WASM=1 pnpm test
pnpm build
pnpm format:check
```

Observed result: 56 tests passed, none skipped; TypeScript and production build passed; formatting passed. The six VeRT tests execute the actual WASM and cover all four actions, exact authorization, nonce replay, ownership, app hash binding, oversized content, expiry, pause and atomic failure behavior. VeRT's test-only Wharfkit 1.2.0 alias matches its internal types; the gateway uses Wharfkit 4.0.2.

The build and emulator evidence above are separate from the subsequent Jungle4 proof recorded in VERIFICATION.md. Live deployment and four irreversible application transactions have also been independently verified through RPC. Eighteen additional irreversible actions now form a RAM dataset; the allowance remains provisional pending held-out validation. Two Linux browser tests pass with a controlled provider. A human external wallet, real AI-provider call and independent security audit remain open.
