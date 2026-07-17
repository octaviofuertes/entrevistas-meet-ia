import { Component, OnInit } from '@angular/core';
import { ApiService } from '../../services/api.service';
import type { Job, Candidate, CandidateRanking, CvRecommendation } from '../../models/types';

const REC_LABEL: Record<CvRecommendation, string> = {
  contratar: 'Contratar',
  entrevistar: 'Entrevistar',
  descartar: 'Descartar',
};

const REC_COLOR: Record<CvRecommendation, string> = {
  contratar: 'bg-green-100 text-green-800',
  entrevistar: 'bg-yellow-100 text-yellow-800',
  descartar: 'bg-red-100 text-red-800',
};

@Component({
  selector: 'app-comparar',
  templateUrl: './comparar.component.html',
})
export class CompararComponent implements OnInit {
  jobs: Job[] = [];
  candidates: Candidate[] = [];
  selectedJobId = '';
  selectedIds = new Set<string>();
  loading = true;
  comparing = false;
  error: string | null = null;
  rankings: CandidateRanking[] | null = null;
  expandedId: string | null = null;

  readonly recLabel = REC_LABEL;
  readonly recColor = REC_COLOR;

  constructor(private api: ApiService) {}

  async ngOnInit() {
    try {
      const [j, c] = await Promise.all([this.api.apiListJobs(), this.api.apiListCandidates()]);
      this.jobs = j;
      const withCv = c.filter(x => x.cvText);
      this.candidates = withCv;
      this.selectedIds = new Set(withCv.map(x => x.id));
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  get selectedJob(): Job | undefined {
    return this.jobs.find(j => j.id === this.selectedJobId);
  }

  get allSelected(): boolean {
    return this.selectedIds.size === this.candidates.length;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  toggleCandidate(id: string) {
    const next = new Set(this.selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selectedIds = next;
  }

  toggleAll() {
    if (this.allSelected) {
      this.selectedIds = new Set();
    } else {
      this.selectedIds = new Set(this.candidates.map(c => c.id));
    }
  }

  onJobChange(id: string) {
    this.selectedJobId = id;
    this.rankings = null;
  }

  toggleExpanded(id: string) {
    this.expandedId = this.expandedId === id ? null : id;
  }

  scoreColor(score: number): string {
    return score >= 7.5 ? 'bg-green-500' : score >= 5 ? 'bg-yellow-400' : 'bg-red-400';
  }

  rankBadgeClass(i: number): string {
    return i === 0 ? 'bg-yellow-400 text-white' : 'bg-slate-100 text-slate-600';
  }

  async handleCompare() {
    if (!this.selectedJobId || this.selectedIds.size === 0) return;
    this.error = null;
    this.rankings = null;
    this.comparing = true;
    try {
      const res = await this.api.apiRankCandidates(this.selectedJobId, Array.from(this.selectedIds));
      this.rankings = res.rankings;
      this.expandedId = res.rankings[0]?.candidateId ?? null;
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.comparing = false;
    }
  }
}
