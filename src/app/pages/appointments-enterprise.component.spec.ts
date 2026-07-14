import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { appointmentPopoverPosition } from './appointments-enterprise.component';

const popover = { width: 340, height: 360 };
const viewport = { width: 1200, height: 800 };

describe('appointmentPopoverPosition', () => {
  it('places the popover on the first horizontal side with enough room', () => {
    expect(appointmentPopoverPosition({ top: 200, right: 200, bottom: 240, left: 100 }, popover, viewport)).toEqual({ x: 212, y: 200 });
    expect(appointmentPopoverPosition({ top: 200, right: 1180, bottom: 240, left: 1080 }, popover, viewport)).toEqual({ x: 728, y: 200 });
  });

  it('keeps the complete popover inside the viewport near the bottom edge', () => {
    expect(appointmentPopoverPosition({ top: 760, right: 200, bottom: 790, left: 100 }, popover, viewport)).toEqual({ x: 212, y: 428 });
  });

  it('uses a vertical side when neither horizontal side fits', () => {
    expect(appointmentPopoverPosition({ top: 100, right: 390, bottom: 140, left: 290 }, { width: 340, height: 200 }, { width: 680, height: 800 })).toEqual({ x: 290, y: 152 });
  });
});