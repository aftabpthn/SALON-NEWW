import { provideZoneChangeDetection } from "@angular/core";
import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, {...appConfig, providers: [provideZoneChangeDetection({ eventCoalescing: true, runCoalescing: true }), ...appConfig.providers]}).catch((err) => {
  console.error(err);
});
