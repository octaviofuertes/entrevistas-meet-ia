import { Component } from '@angular/core';
import { Router } from '@angular/router';

const NAV = [
  { href: '/', label: 'Dashboard', icon: 'D' },
  { href: '/empresas', label: 'Empresas', icon: 'Em' },
  { href: '/puestos', label: 'Puestos', icon: 'P' },
  { href: '/candidatos', label: 'Candidatos', icon: 'C' },
  { href: '/comparar', label: 'Comparar CVs', icon: 'CV' },
  { href: '/entrevistas', label: 'Entrevistas', icon: 'E' },
];

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  nav = NAV;

  constructor(private router: Router) {}

  get isSala(): boolean {
    return this.router.url.startsWith('/sala/');
  }

  isActive(href: string): boolean {
    if (href === '/') return this.router.url === '/';
    return this.router.url.startsWith(href);
  }
}
