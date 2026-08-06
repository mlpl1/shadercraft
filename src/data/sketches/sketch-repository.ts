export type Sketch = {
  id: string;
  title: string;
  source: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. Advanced by every source or title change; drives list ordering. */
  updatedAt: string;
};

/**
 * Learner-authored shaders. Every method takes `profileId` explicitly rather than holding an active
 * profile, matching `ProgressRepository` — the caller already knows which profile is active, and a
 * repository that remembers it can serve the wrong one after an account switch.
 */
export interface SketchRepository {
  /** Most recently updated first. */
  list(profileId: string): Promise<Sketch[]>;
  /** `null` when the sketch does not exist or belongs to another profile. */
  get(profileId: string, id: string): Promise<Sketch | null>;
  create(profileId: string, title: string, source: string): Promise<Sketch>;
  updateSource(profileId: string, id: string, source: string): Promise<void>;
  rename(profileId: string, id: string, title: string): Promise<void>;
  delete(profileId: string, id: string): Promise<void>;
}
