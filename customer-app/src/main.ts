import { bootstrapApplication } from "@angular/platform-browser";
import { RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules } from "@angular/router";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { IonicRouteStrategy, provideIonicAngular } from "@ionic/angular/standalone";
import { AppComponent } from "./app/app.component";
import { routes } from "./app/app.routes";
import { authInterceptor } from "./app/core/auth.interceptor";
import { csrfInterceptor } from "./app/core/csrf.interceptor";

bootstrapApplication(AppComponent, {
  providers: [
    provideIonicAngular(),
    provideHttpClient(withInterceptors([csrfInterceptor, authInterceptor])),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy }
  ]
}).catch((error) => console.error(error));
