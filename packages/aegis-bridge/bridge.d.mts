export type AegisAccounting = {
  version: number;
  check: string;
  scope: string;
  source: {
    repository: string;
    commit: string;
    version: string;
    module: string;
    sha256: string;
    function: string;
  };
  observationDigest: string;
  unit: string;
  result: {
    root_authorized: number;
    available: number;
    reserved: number;
    quarantined: number;
    consumed: number;
    released: number;
    accounted: number;
    conserved: boolean;
  };
  executionAuthorized: false;
  aegisPolicyVerdict: "NOT_EVALUATED";
  vaultRamBacking: "UNAVAILABLE";
  missing: string[];
  trust: string;
};
export function inspectAegisAccounting(raw: unknown): Promise<AegisAccounting>;
export function auditAegisAccounting(options: {
  rpc: (method: string, body: object) => Promise<any>;
  rpcName?: string;
}): Promise<{ observation: any; aegis: AegisAccounting }>;
