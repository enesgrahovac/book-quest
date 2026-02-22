export const STATE_DOC_KEYS = [
  "SOUL",
  "PROFILE",
  "PREFERENCES",
  "MEMORY",
  "TUTOR_PERSONA"
] as const;

export type StateDocKey = (typeof STATE_DOC_KEYS)[number];

export type StateDocument = {
  key: StateDocKey;
  content: string;
  updatedAt: string;
};
