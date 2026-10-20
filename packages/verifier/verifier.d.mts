export class VerificationError extends Error {
  unavailable: boolean;
  constructor(message: string, unavailable?: boolean);
}
export function createRpc(
  name: string,
  transport?: typeof fetch,
): (method: string, body: object) => Promise<any>;
export function verifyEvidence(
  bundle: unknown,
  options?: {
    profileName?: string;
    rpc?: (method: string, body: object) => Promise<any>;
    rpcName?: string;
  },
): Promise<any>;
