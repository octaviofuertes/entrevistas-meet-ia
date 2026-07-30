import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
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

const routes: Routes = [
  { path: '', component: DashboardComponent },
  { path: 'empresas', component: EmpresasListComponent },
  { path: 'empresas/nueva', component: EmpresaNuevaComponent },
  { path: 'empresas/:id', component: EmpresaDetailComponent },
  { path: 'puestos', component: PuestosListComponent },
  { path: 'puestos/nuevo', component: PuestosNuevoComponent },
  { path: 'puestos/:id', component: PuestoDetailComponent },
  // La sección Candidatos completa ('candidatos', 'candidatos/nuevo') y
  // 'comparar' se eliminaron: los postulantes, su ficha, el match y el ranking
  // viven dentro de la ficha del puesto (RF-01/RF-03/RF-04). Los links viejos
  // caen en el wildcard y redirigen al dashboard.
  { path: 'entrevistas', component: EntrevistasListComponent },
  { path: 'entrevistas/nueva', component: EntrevistaNuevaComponent },
  { path: 'entrevistas/:id/informe', component: InformeComponent },
  { path: 'entrevistas/:id', component: EntrevistaDetailComponent },
  { path: 'sala/:id', component: SalaComponent },
  { path: '**', redirectTo: '' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
