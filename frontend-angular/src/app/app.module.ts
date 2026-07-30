import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';

// Shared components
import { StatusBadgeComponent } from './components/status-badge/status-badge.component';
import { ScoreBarComponent } from './components/score-bar/score-bar.component';
import { AnalyticsDonutComponent } from './components/analytics-donut/analytics-donut.component';
import { RadarChartComponent } from './components/radar-chart/radar-chart.component';

// Pages
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { EmpresasListComponent } from './pages/empresas-list/empresas-list.component';
import { EmpresaNuevaComponent } from './pages/empresa-nueva/empresa-nueva.component';
import { EmpresaDetailComponent } from './pages/empresa-detail/empresa-detail.component';
import { PuestosListComponent } from './pages/puestos-list/puestos-list.component';
import { PuestosNuevoComponent } from './pages/puestos-nuevo/puestos-nuevo.component';
import { PuestoDetailComponent } from './pages/puesto-detail/puesto-detail.component';
import { EntrevistasListComponent } from './pages/entrevistas-list/entrevistas-list.component';
import { EntrevistaNuevaComponent } from './pages/entrevista-nueva/entrevista-nueva.component';
import { EntrevistaDetailComponent } from './pages/entrevista-detail/entrevista-detail.component';
import { InformeComponent } from './pages/informe/informe.component';
import { SalaComponent } from './pages/sala/sala.component';

@NgModule({
  declarations: [
    AppComponent,
    StatusBadgeComponent,
    ScoreBarComponent,
    AnalyticsDonutComponent,
    RadarChartComponent,
    DashboardComponent,
    EmpresasListComponent,
    EmpresaNuevaComponent,
    EmpresaDetailComponent,
    PuestosListComponent,
    PuestosNuevoComponent,
    PuestoDetailComponent,
    EntrevistasListComponent,
    EntrevistaNuevaComponent,
    EntrevistaDetailComponent,
    InformeComponent,
    SalaComponent,
  ],
  imports: [
    BrowserModule,
    HttpClientModule,
    FormsModule,
    AppRoutingModule,
  ],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
