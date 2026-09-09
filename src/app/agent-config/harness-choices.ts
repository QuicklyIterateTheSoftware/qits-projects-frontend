import type {
  AgentCapabilityCatalogueDto,
  AgentHarnessCapabilityDto,
} from '../api/agent-configuration-api';

/** What the model and effort controls look like for one harness, and one chosen model. */
export interface HarnessChoices {
  /**
   * The models to offer, and **not** the legal values. A model the harness never enumerated must
   * still be settable, which is why the control is a combobox rather than a select — see
   * {@link modelsAreAliases}.
   */
  readonly models: readonly string[];
  /**
   * True when the harness has no command that lists models, so what is offered is a shipped alias
   * set. The editor leads with the free-text escape when it is true, because pinning a full model
   * id is exactly what somebody comes to this page to do.
   */
  readonly modelsAreAliases: boolean;
  /**
   * Whether an effort control is drawn **at all**. False for a harness with no effort concept, and
   * then there is no control — not a disabled one carrying the other harness's values.
   */
  readonly effortApplies: boolean;
  /** The effort levels to offer, empty when {@link effortApplies} is false. */
  readonly effortLevels: readonly string[];
  /** True when nothing has ever reported for this harness and these lists are shipped fallbacks. */
  readonly reported: boolean;
  /** One sentence about where these lists came from, or null when there is nothing worth saying. */
  readonly provenance: string | null;
}

/**
 * What is known about a harness when the catalogue has nothing to say about it.
 *
 * <p>Both controls stay, and both take whatever is typed. That is the honest answer to "no report":
 * the platform does not know what this harness offers, and hiding the effort control would be a
 * *claim* — the claim Kimi's report actually makes — rather than an absence of one. Suppressing a
 * control on ignorance is how a configuration silently loses a value it was already holding.
 */
const UNREPORTED: HarnessChoices = {
  models: [],
  modelsAreAliases: true,
  effortApplies: true,
  effortLevels: [],
  reported: false,
  provenance:
    'No container has reported what this harness offers yet, so nothing is listed. Both values are still sent exactly as they are typed.',
};

/**
 * The cascade, as one function: **harness → what the model and effort controls are**.
 *
 * <p>The whole reason this is a report rather than a constant is that the two harnesses answer
 * differently in kind. Claude Code has `--effort` with levels its own `--help` enumerates and **no
 * command that lists models at all**; Kimi Code has a machine-readable model catalogue and **no
 * effort flag whatsoever**. A platform that hardcoded either would be wrong about the other, and
 * would be wrong about both the next time an image is rebuilt.
 *
 * <p>`chosenModel` is taken and, today, does not narrow the effort levels. That is not an oversight
 * and it is worth being precise about: Claude's documentation says available effort levels *depend
 * on the model*, but the capability report carries one effort list per harness and no per-model
 * split, so narrowing here would mean **this page inventing a rule no binary reported**. The
 * parameter is the seam — when the report grows the split, this is the one place that changes, and
 * every caller already passes the model.
 */
export function choicesFor(
  catalogue: AgentCapabilityCatalogueDto | null,
  harness: string,
  chosenModel: string,
): HarnessChoices {
  const report = capabilityFor(catalogue, harness);
  if (!report) {
    return UNREPORTED;
  }
  return {
    models: dedupe([...report.models, ...(chosenModel ? [chosenModel] : [])]),
    modelsAreAliases: !report.modelsEnumerated,
    effortApplies: report.effortSupported,
    effortLevels: report.effortSupported ? report.effortLevels : [],
    reported: !report.shipped,
    provenance: provenanceOf(report),
  };
}

/** The report for one harness, or null when the catalogue holds none. Case-insensitive on the key. */
export function capabilityFor(
  catalogue: AgentCapabilityCatalogueDto | null,
  harness: string,
): AgentHarnessCapabilityDto | null {
  const wanted = harness.trim().toUpperCase();
  return (
    catalogue?.harnesses.find((entry) => entry.harness.trim().toUpperCase() === wanted) ?? null
  );
}

/**
 * The effort levels to *offer*, with a value already stored kept in the list.
 *
 * <p>A stored value the report does not list is not dropped: the harness may have been upgraded
 * under it, or the report may be a shipped fallback. Silently removing it from the list would make
 * the control render as "nothing chosen" and the next save would clear a value nobody decided to
 * clear — a data loss disguised as a dropdown.
 */
export function effortOptions(choices: HarnessChoices, current: string): readonly string[] {
  return dedupe([...choices.effortLevels, ...(current ? [current] : [])]);
}

/**
 * The effort a save should carry, given the harness that was chosen.
 *
 * <p>A harness that reports no effort concept stores **none**. The editor shows no control for it, so
 * keeping the old value would be the disabled-control problem moved into storage: invisible on the
 * page, still in the record, and still what a reader of the store would believe. The launch renders
 * nothing for it either way; clearing it is what makes the page and the row agree.
 */
export function effortToStore(choices: HarnessChoices, current: string): string {
  return choices.effortApplies ? current : '';
}

/** One sentence about where a report came from, or null when it is unremarkable. */
function provenanceOf(report: AgentHarnessCapabilityDto): string | null {
  if (report.shipped) {
    return 'No container has reported yet, so this is the shipped fallback set. It refreshes the first time a container on a new image starts.';
  }
  if (report.probeFailed) {
    const detail = report.probeDetail?.trim();
    return `The probe did not answer, so this is the shipped fallback set${detail ? ` — ${detail}` : ''}.`;
  }
  const version = report.harnessVersion?.trim();
  const image = report.imageVersion?.trim();
  if (!version && !image) {
    return null;
  }
  return `Reported by ${version || 'the harness'}${image ? ` on image ${image}` : ''}.`;
}

function dedupe(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
