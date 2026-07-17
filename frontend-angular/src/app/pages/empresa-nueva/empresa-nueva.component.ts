import { Component, ElementRef, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../services/api.service';
import type { CompanyType } from '../../models/types';

@Component({
  selector: 'app-empresa-nueva',
  templateUrl: './empresa-nueva.component.html',
})
export class EmpresaNuevaComponent {
  @ViewChild('logoInput') logoInput!: ElementRef<HTMLInputElement>;

  name = '';
  logoUrl: string | null = null;
  logoPreview: string | null = null;
  country = '';
  cuit = '';
  type: CompanyType | '' = '';
  mission = '';
  vision = '';
  busy = false;
  error: string | null = null;

  constructor(private api: ApiService, private router: Router) {}

  handleLogoFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      this.logoUrl = ev.target?.result as string;
      this.logoPreview = this.logoUrl;
    };
    reader.readAsDataURL(file);
  }

  async onSubmit(event: Event) {
    event.preventDefault();
    this.busy = true;
    this.error = null;
    try {
      const company = await this.api.apiCreateCompany({
        name: this.name,
        logoUrl: this.logoUrl || null,
        country: this.country || null,
        cuit: this.cuit || null,
        mission: this.mission || null,
        vision: this.vision || null,
        type: (this.type as CompanyType) || null,
      });
      this.router.navigate(['/empresas', company.id]);
    } catch (e: any) {
      this.error = e.message;
    } finally {
      this.busy = false;
    }
  }
}
