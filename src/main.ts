import { bootstrapApplication } from '@angular/platform-browser';
import { ErrorHandler } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { provideRouter, RouteReuseStrategy, withComponentInputBinding, withPreloading } from '@angular/router';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { csrfInterceptor } from './app/core/csrf.interceptor';
import { GlobalErrorHandler } from './app/core/global-error-handler';
import { httpErrorInterceptor } from './app/core/http-error.interceptor';
import { NavigationPreloadingStrategy } from './app/core/navigation-preloading.strategy';
import { RefreshOnNavigationRouteReuseStrategy } from './app/core/refresh-on-navigation-route-reuse.strategy';
import { AURA_DATE_PIPE_DEFAULT_OPTIONS } from './app/core/i18n.service';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(withInterceptors([csrfInterceptor, httpErrorInterceptor])),
    provideRouter(routes, withComponentInputBinding(), withPreloading(NavigationPreloadingStrategy)),
    { provide: RouteReuseStrategy, useClass: RefreshOnNavigationRouteReuseStrategy },
    { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: AURA_DATE_PIPE_DEFAULT_OPTIONS },
    { provide: ErrorHandler, useClass: GlobalErrorHandler }
  ]
}).catch((error) => console.error(error));
