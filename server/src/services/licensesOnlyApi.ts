/**
 * Backend for customers without case access (not on Fusion / no cases / no MDR service): only the licenses can be
 * read. Every case operation answers 405 `licenses_only`; the UI never calls them (it only shows the Licenses tab).
 */
import type { Capabilities, TenantLicenses } from '../types';
import type { CaseBackend } from './backend';
import { SophosError } from './sophosConnection';

const no = (): never => {
  throw new SophosError('licenses_only', 405);
};

export class LicensesOnlyApi implements CaseBackend {
  readonly kind = 'licenses' as const;
  readonly capabilities: Capabilities = { comments: false, classify: false, ai: false };

  constructor(private readonly load: (force: boolean) => Promise<TenantLicenses>) {}

  getLicenses(force = false) {
    return this.load(force);
  }
  getCases() {
    return Promise.resolve(no());
  }
  getCaseDetails() {
    return Promise.resolve(no());
  }
  addCaseComment() {
    return Promise.resolve(no());
  }
  getReference() {
    return Promise.resolve(no());
  }
  classifyCase() {
    return Promise.resolve(no());
  }
  aiCaseSummary() {
    return Promise.resolve(no());
  }
  aiDetection() {
    return Promise.resolve(no());
  }
  getDashboard() {
    return Promise.resolve(no());
  }
  getCounts() {
    return Promise.resolve(no());
  }
}
