# AppSpec v1

The executable source of truth is packages/core/src/index.ts: AppSpecSchema, PayloadSchema and compile. All objects reject unknown fields.

| Field       | Constraint                                                       |
| ----------- | ---------------------------------------------------------------- |
| version     | 1                                                                |
| template    | agent-marketplace                                                |
| name        | 1–60 UTF-8 bytes                                                 |
| description | 1–500 UTF-8 bytes                                                |
| accent      | mint, blue or amber                                              |
| entities    | exact ordered tuple: agents, services, memories                  |
| actions     | exact ordered tuple: createagent, pubservice, writemem, setstate |
| maxRows     | 1000                                                             |
| publicData  | true                                                             |

The AI provider may supply descriptive fields only. Local validation runs after provider JSON parsing; one repair is attempted. Fixture mode returns exampleSpec and does not interpret the prompt. Neither mode generates arbitrary executable code.

Canonical JSON sorts object keys, preserves array order and accepts safe integers. The full app hash is Keccak-256 of canonical AppSpec. The first 64 bits become the decimal app ID; zero maps to one. Deployment and execution also check the full hash, rejecting a different spec that collides on the short ID.

Changing name, description or accent creates a new app hash and ID. In live mode the new app needs explicit administrator registration. The Studio’s Deploy button checks registration; it does not hold an administrator key or deploy arbitrary code.

The generated React component and fixed Studio preview share the validated specification. Generated source is inspectable but is not evaluated dynamically by the preview. The available actions use uint64 decimal string IDs; service and memory parents must be agents owned by the signer. Agent status supports active or paused. Numeric reputation is future work.
