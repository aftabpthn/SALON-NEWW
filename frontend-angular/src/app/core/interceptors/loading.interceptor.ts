import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { finalize } from 'rxjs';
import { environment } from '../../../environments/environment';
import { LoadingTickerService } from '../services/loading-ticker.service';

export const loadingInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isCoreApiRequest(request.url)) return next(request);

  const loadingTicker = inject(LoadingTickerService);
  loadingTicker.beginRequest();
  return next(request).pipe(finalize(() => loadingTicker.endRequest()));
};

function isCoreApiRequest(url: string): boolean {
  if (url.startsWith('/api/') || url.startsWith('api/')) return true;
  const apiBase = environment.apiBaseUrl.replace(/\/+$/, '');
  return Boolean(apiBase && url.startsWith(apiBase));
}
