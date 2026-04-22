/**
 * Thin types for Apidog responses. Keep these deliberately loose — the
 * shapes come from a third-party API we don't control and will evolve.
 * Prefer unknown + narrowing at use sites over hand-maintained giant
 * interfaces.
 */

export interface ApidogListResponse<T> {
  data?: T[];
  items?: T[];
  total?: number;
  [k: string]: unknown;
}

export interface ApidogProjectSummary {
  id: string;
  name: string;
  [k: string]: unknown;
}
