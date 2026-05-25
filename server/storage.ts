/**
 * In-memory storage for PolicyDocuments.
 * Replace with DB (drizzle/postgres) when persistence is needed.
 */

import type { PolicyDocument } from "../shared/types.js";

const store = new Map<string, PolicyDocument>();

export function savePolicy(doc: PolicyDocument): void {
  store.set(doc.id, doc);
}

export function getPolicy(id: string): PolicyDocument | undefined {
  return store.get(id);
}

export function listPolicies(): PolicyDocument[] {
  return [...store.values()].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export function deletePolicy(id: string): boolean {
  return store.delete(id);
}
