// Executable code comes exclusively from this reviewed template, never the model.
export function applicationSource(name: string, description: string) {
  return `import React from 'react';

export const metadata = ${JSON.stringify({ name, description }, null, 2)} as const;
type Agent = {id:string; owner:string; name:string; description:string; status:string};
type Props = {
  agents: Agent[];
  services: number;
  memories: number;
  onCreateAgent: () => void;
  onInspect: (id:string) => void;
};
// Mount with your gateway adapter. The host owns wallet signing and review UI.
// Strings are rendered as text; no raw HTML, eval, or generated permissions.
export default function Application({agents,services,memories,onCreateAgent,onInspect}:Props) {
  return <main aria-label={metadata.name}>
    <header><h1>{metadata.name}</h1><p>{metadata.description}</p></header>
    <p>{agents.length} agents · {services} services · {memories} memories</p>
    <button onClick={onCreateAgent}>Create agent</button>
    <section aria-label="Public agents">{agents.map(agent =>
      <article key={agent.id}>
        <h2>{agent.name}</h2><p>{agent.description}</p>
        <p>{agent.status} · {agent.owner}</p>
        <button onClick={() => onInspect(agent.id)}>Inspect state</button>
      </article>
    )}</section>
    <small>Public data. Gateway-mediated authorization. No payments or bridge.</small>
  </main>;
}
`;
}
