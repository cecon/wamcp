import type { Catalog } from './types';
import type { ReportSection } from './route';
import { OverviewReport } from './reports/OverviewReport';
import { BreakdownReport } from './reports/BreakdownReport';
import { CsatReport } from './reports/CsatReport';
import { BotsReport, SlaReport } from './reports/SummaryReports';

interface Props {
  catalog: Catalog;
  section?: ReportSection;
}

/** Chatwoot reports section (administrators); the sidebar picks the page. */
export function Reports({ catalog, section = 'overview' }: Props) {
  switch (section) {
    case 'overview':
      return <OverviewReport catalog={catalog} />;
    case 'agents':
      return <BreakdownReport key="agent" kind="agent" />;
    case 'inboxes':
      return <BreakdownReport key="inbox" kind="inbox" />;
    case 'teams':
      return <BreakdownReport key="team" kind="team" />;
    case 'labels':
      return <BreakdownReport key="label" kind="label" />;
    case 'csat':
      return <CsatReport />;
    case 'bots':
      return <BotsReport />;
    case 'sla':
      return <SlaReport />;
  }
}
