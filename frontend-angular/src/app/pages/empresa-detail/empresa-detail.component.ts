import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../../services/api.service';
import type { Company, CompanyType } from '../../models/types';

@Component({
  selector: 'app-empresa-detail',
  templateUrl: './empresa-detail.component.html',
})
export class EmpresaDetailComponent implements OnInit {
  @ViewChild('logoInput') logoInput!: ElementRef<HTMLInputElement>;

  company: Company | null = null;
  loading = true;
  error: string | null = null;

  name = '';
  logoPreview: string | null = null;
  newLogoUrl: string | null | undefined = undefined;
  country = '';
  cuit = '';
  type: CompanyType | '' = '';
  mission = '';
  vision = '';
  busy = false;
  saved = false;

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  async ngOnInit() {
    const id = this.route.snapshot.params['id'];
    try {
      const c = await this.api.apiGetCompany(id);
      this.company = c;
      this.name = c.name;
      this.logoPreview = c.logoUrl ?? null;
      this.country = c.country ?? '';
      this.cuit = c.cuit ?? '';
      this.type = (c.type as CompanyType | '') ?? '';
      this.mission = c.mission ?? '';
      this.vision = c.vision ?? '';
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.loading = false;
    }
  }

  handleLogoFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      this.newLogoUrl = ev.target?.result as string;
      this.logoPreview = this.newLogoUrl;
    };
    reader.readAsDataURL(file);
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    const id = this.route.snapshot.params['id'];
    this.busy = true;
    this.saved = false;
    try {
      const updated = await this.api.apiUpdateCompany(id, {
        name: this.name,
        ...(this.newLogoUrl !== undefined ? { logoUrl: this.newLogoUrl } : {}),
        country: this.country || null,
        cuit: this.cuit || null,
        mission: this.mission || null,
        vision: this.vision || null,
        type: (this.type as CompanyType) || null,
      });
      this.company = updated;
      this.saved = true;
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
}
