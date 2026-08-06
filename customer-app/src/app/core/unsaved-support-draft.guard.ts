import { CanDeactivateFn } from "@angular/router";

export interface UnsavedSupportDraftComponent {
  canLeaveSupportSubflow?: () => boolean | Promise<boolean>;
}

export const unsavedSupportDraftGuard: CanDeactivateFn<UnsavedSupportDraftComponent> = (component) => {
  return component.canLeaveSupportSubflow ? component.canLeaveSupportSubflow() : true;
};
