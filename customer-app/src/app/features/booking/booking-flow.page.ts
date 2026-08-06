import { Component, OnDestroy, OnInit, computed, signal } from "@angular/core";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { IonButton, IonContent, IonIcon } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { alertCircleOutline, arrowBackOutline, calendarOutline, callOutline, chatbubbleOutline, checkmarkCircleOutline, checkmarkOutline, chevronBackOutline, chevronDownOutline, chevronForwardOutline, flashOutline, locationOutline, personOutline, searchOutline, sparklesOutline, storefrontOutline, timeOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AvailabilityDay, AvailabilitySlot, ServiceItem, StaffMember } from "../../core/api.types";
import { BookingProgressComponent, BookingProgressStepId } from "./booking-progress.component";
import { CustomerMobileHeaderComponent } from "../../shared/customer-mobile-header.component";

const PENDING_BOOKING_INTENT_KEY = "auraCustomerPendingBookingIntent";

type PendingBookingIntent = {
  slug: string;
  items?: BookingFlowItem[];
  serviceId?: string;
  staffId?: string | null;
  date: string;
  slotStartAt?: string;
  activeItemIndex?: number;
  step: number;
  savedAt: number;
};

type BookingFlowItem = {
  serviceId: string;
  staffId: string | null;
  date: string;
  slotStartAt: string;
};

@Component({
  standalone: true,
  imports: [IonButton, IonContent, IonIcon, RouterLink, BookingProgressComponent, CustomerMobileHeaderComponent],
  template: `
    <aura-customer-mobile-header
      [title]="isRescheduling() ? 'Edit appointment' : 'Book appointment'"
      [subtitle]="headerSubtitle()"
      [backHref]="backHref()" />

    <ion-content>
      @if (business(); as business) {
        @if (hasBookableServices() || marketplace.loading()) {
        <main class="page booking-page" [class.editing]="isRescheduling()">
          @if (!isRescheduling()) {
            <section class="booking-hero premium-card">
              <div>
                <h1 class="page-title">Book your visit</h1>
                <p class="muted">{{ business.businessName }} · {{ business.area }} @if (heroRatingLabel(); as label) { · {{ label }} }</p>
              </div>
            </section>
          }

          @if (marketplace.error()) {
            <section class="state-card premium-card error"><h2>Booking data unavailable</h2><p>{{ marketplace.error() }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }

          @if (flowWarning()) {
            <section class="state-card premium-card flow-warning" role="status"><h2>Selections updated</h2><p>{{ flowWarning() }}</p></section>
          }

          @if (isRescheduling()) {
            <section class="edit-context-card premium-card" aria-label="Current appointment being edited">
              <span>Edit appointment</span>
              <strong>{{ activeService()?.name || selectedServices()[0]?.name || 'Selected service' }}</strong>
              <small>{{ itemSlotLabel(0) || 'Current time will be preserved until changed' }} · {{ activeStaffName() }}</small>
            </section>
          }

          <app-booking-progress [currentStep]="currentBookingStep()" (stepSelect)="goToStep($event)" />

          @if (currentBookingStep() === 1) {
            <section class="panel service-panel">
              <div class="section-heading"><div><h2 class="section-title">Choose a service</h2><p class="muted">Pick one or more services for your visit</p></div></div>

              <label class="service-search">
                <ion-icon name="search-outline" aria-hidden="true"></ion-icon>
                <input type="search" [value]="serviceQuery()" (input)="onServiceSearch($event)" placeholder="Search services" aria-label="Search services" />
              </label>

              <div class="category-chips" role="group" aria-label="Service categories">
                @for (chip of serviceChips(); track chip) {
                  <button type="button" class="category-chip" [class.active]="activeCategory() === chip" (click)="setActiveCategory(chip)">{{ chip }}</button>
                }
              </div>

              @for (group of groupedServices(); track group.label) {
                <section class="service-group" [class.collapsed]="groupCollapsed(group.label)">
                  <button type="button" class="group-header" (click)="toggleGroup(group.label)" [attr.aria-expanded]="!groupCollapsed(group.label)">
                    <span class="group-title">{{ group.label }}</span>
                    <span class="group-count">{{ group.services.length }}</span>
                    <ion-icon name="chevron-down-outline" aria-hidden="true"></ion-icon>
                  </button>
                  @if (!groupCollapsed(group.label)) {
                    <div class="service-list">
                      @for (service of group.services; track service.id) {
                        <div class="service-card premium-card" [class.selected]="isServiceSelected(service.id)" [class.expanded]="expandedServiceId() === service.id">
                          <button type="button" class="service-card-main" (click)="toggleServiceDetails(service.id)" [attr.aria-expanded]="expandedServiceId() === service.id">
                            <span class="service-title-row">
                              <strong class="service-name">{{ formatServiceName(service.name) }}</strong>
                              @if (service.popular) { <span class="offer-pill">Popular</span> }
                              @if (service.durationMinutes >= 120) { <span class="offer-pill extended">Extended visit</span> }
                            </span>
                            <span class="service-price-row">
                              <strong>{{ money(service.pricePaise) }}</strong>
                              <span>{{ service.durationMinutes || 0 }} min</span>
                            </span>
                            <span class="service-desc">{{ serviceDescription(service) }}</span>
                          </button>
                          <div class="service-card-footer">
                            <span class="service-eligibility">{{ eligibleStaffLabel(service) }}</span>
                            <button type="button" class="add-service-btn" [class.added]="isServiceSelected(service.id)" [attr.aria-pressed]="isServiceSelected(service.id)" (click)="toggleService(service.id)">
                              @if (isServiceSelected(service.id)) { <ion-icon name="checkmark-outline" aria-hidden="true"></ion-icon> Added } @else { Add }
                            </button>
                          </div>
                          @if (expandedServiceId() === service.id) {
                            <div class="service-details">
                              <p>{{ service.description || serviceDescription(service) }}</p>
                              <dl>
                                <div><dt>Duration</dt><dd>{{ service.durationMinutes || 0 }} min</dd></div>
                                <div><dt>Price</dt><dd>{{ money(service.pricePaise) }}</dd></div>
                                <div><dt>Eligible professionals</dt><dd>{{ eligibleStaffLabel(service) }}</dd></div>
                              </dl>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </section>
              } @empty {
                <section class="state-card premium-card stable-state"><h2>No services match your search</h2><p class="muted">Try a different keyword or category.</p></section>
              }
            </section>
          }

          @if (currentBookingStep() === 2) {
            <section class="panel">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Choose professionals</h2>
                  <p class="muted">
                    @if (bookingItems().length > 1) {
                      Select professional for <strong>Service {{ activeItemIndex() + 1 }} of {{ bookingItems().length }}</strong> ({{ activeService()?.name }}).
                    } @else {
                      Pick staff for your selected service.
                    }
                  </p>
                </div>
              </div>

              <div class="assign-mode-card premium-card">
                <div class="assign-mode-toggle" role="radiogroup" aria-label="Professional assignment mode">
                  <button type="button" role="radio" [attr.aria-checked]="assignmentMode() === 'auto'" [class.active]="assignmentMode() === 'auto'" (click)="setAssignmentMode('auto')">Best available</button>
                  <button type="button" role="radio" [attr.aria-checked]="assignmentMode() === 'manual'" [class.active]="assignmentMode() === 'manual'" (click)="setAssignmentMode('manual')">Choose manually</button>
                </div>
                @if (assignmentMode() === 'auto') {
                  <p class="assign-mode-help">We'll assign qualified professionals and find the earliest continuous appointment.</p>
                } @else {
                  <p class="assign-mode-help">Pick a professional for each service. Best available stays one tap away for any service.</p>
                }
              </div>

              @if (assignmentMode() === 'auto') {
                <button type="button" class="best-available-card premium-card" [class.selected]="allAutoAssigned()" (click)="assignAnyStaffToAll()">
                  <span class="any-avatar"><ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon></span>
                  <span class="best-available-copy">
                    <strong>Best available professionals <span class="recommend-tag">Recommended</span></strong>
                    <small>We'll assign qualified professionals and find the earliest continuous appointment.</small>
                  </span>
                  <span class="best-available-state">
                    @if (allAutoAssigned()) { <ion-icon name="checkmark-outline" aria-hidden="true"></ion-icon> Assigned }
                    @else { Assign all {{ bookingItems().length }} }
                  </span>
                </button>
              }

              <div class="service-assign-list" aria-label="Services and professionals">
                @for (item of bookingItems(); track item.serviceId; let itemIndex = $index) {
                  @if (serviceById(item.serviceId); as service) {
                    <section class="service-assign-card premium-card" [class.open]="activeItemIndex() === itemIndex">
                      <button type="button" class="service-assign-head" [attr.aria-expanded]="activeItemIndex() === itemIndex" (click)="setActiveItem(itemIndex)">
                        <span class="service-assign-index">{{ itemIndex + 1 }}</span>
                        <span class="service-assign-copy">
                          <strong>{{ formatServiceName(service.name) }}</strong>
                          <small>{{ money(service.pricePaise) }} · {{ service.durationMinutes || 0 }} min · {{ assigneeLabel(item) }}</small>
                        </span>
                        <span class="service-assign-state">
                          @if (item.staffId === null) { <span class="assign-badge auto">Best available</span> }
                          @else if (item.staffId) { <span class="assign-badge manual"><ion-icon name="checkmark-outline" aria-hidden="true"></ion-icon> Assigned</span> }
                          @else { <span class="assign-badge pending">Not assigned</span> }
                          <ion-icon name="chevron-down-outline" aria-hidden="true"></ion-icon>
                        </span>
                      </button>

                      @if (activeItemIndex() === itemIndex) {
                        <div class="service-assign-body">
                          @if (pendingStaffChange()?.index === itemIndex) {
                            <div class="slot-reset-warning" role="alert">
                              <p>Changing the professional will reset the selected time for this service.</p>
                              <div>
                                <button type="button" class="warning-ghost" (click)="cancelStaffChange()">Keep time</button>
                                <button type="button" class="warning-confirm" (click)="confirmStaffChange()">Change professional</button>
                              </div>
                            </div>
                          }

                          @if (assignmentMode() === 'auto') {
                            <button type="button" class="per-service-auto premium-card" [class.selected]="item.staffId === null" (click)="pickStaff(itemIndex, null)">
                              <span class="any-avatar"><ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon></span>
                              <span>
                                <strong>Use best available</strong>
                                <small>Qualified professional · earliest continuous appointment</small>
                              </span>
                              <em>{{ item.staffId === null ? "Assigned" : "Select" }}</em>
                            </button>
                          } @else {
                            @if (staffGenders(service).length) {
                              <div class="gender-filter" role="group" aria-label="Preferred professional gender">
                                <button type="button" class="gender-chip" [class.active]="activeGenderFilter() === ''" (click)="activeGenderFilter.set('')">No preference</button>
                                @for (gender of staffGenders(service); track gender) {
                                  <button type="button" class="gender-chip" [class.active]="activeGenderFilter() === gender" (click)="activeGenderFilter.set(gender)">{{ gender }}</button>
                                }
                              </div>
                              <p class="gender-note">No preference may produce earlier availability.</p>
                            }

                            <button type="button" class="staff-choice premium-card" [class.selected]="item.staffId === null" (click)="pickStaff(itemIndex, null)">
                              <span class="any-avatar"><ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon></span>
                              <span class="staff-copy">
                                <strong>Best available</strong>
                                <small class="staff-role">We'll assign a qualified professional · earliest appointment</small>
                              </span>
                              <em>{{ item.staffId === null ? "Assigned" : "Select" }}</em>
                            </button>

                            @for (staff of filteredStaffForService(service); track staff.id) {
                              <button type="button" class="staff-choice premium-card" [class.selected]="item.staffId === staff.id" (click)="pickStaff(itemIndex, staff.id)">
                                <span class="staff-avatar" [style.background]="staff.avatarGradient || 'var(--primary)'">
                                  @if (staff.image) { <img [src]="staff.image" [alt]="staff.name" /> }
                                  @else { <span class="staff-initials">{{ staffInitials(staff.name) }}</span> }
                                </span>
                                <span class="staff-copy">
                                  <strong>{{ formatServiceName(staff.name) }}</strong>
                                  <small class="staff-role">{{ staff.title }} @if (staff.rating) { · ★ {{ staff.rating }} }</small>
                                  @if (staff.specialty) { <small class="staff-tag">{{ staff.specialty }}</small> }
                                  <small class="staff-meta">
                                    @if (staff.experienceYears) { <span>{{ staff.experienceYears }} yrs experience</span> }
                                    @if (staff.nextAvailable) { <span><ion-icon name="time-outline" aria-hidden="true"></ion-icon> Next: {{ staff.nextAvailable }}</span> }
                                  </small>
                                </span>
                                <span class="staff-extras">
                                  @if (staffSurcharge(service, staff); as extra) { <span class="surcharge-chip">{{ extra }}</span> }
                                  <em>{{ item.staffId === staff.id ? "Assigned" : "Select" }}</em>
                                </span>
                              </button>
                            } @empty {
                              @if (activeGenderFilter()) { <p class="muted">No professionals match your preference.</p> }
                              @else { <p class="muted">Best available will be assigned for this service.</p> }
                            }
                          }
                        </div>
                      }
                    </section>
                  }
                }
              </div>
            </section>
          }

          @if (currentBookingStep() === 3) {
            <section class="panel date-time-panel">
              <div class="section-heading">
                <div>
                  <h2 class="section-title">Pick date and time</h2>
                  <p class="muted">
                    @if (continuousVisitMode()) { Select one date and start time for your complete visit sequence. }
                    @else { Select non-overlapping slots for each service. }
                  </p>
                </div>
              </div>

              <!-- Compact summary & mode switcher bar -->
              <div class="visit-summary-bar premium-card">
                <div class="visit-summary-info">
                  <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon>
                  <div>
                    <strong>{{ serviceCountLabel() }} · {{ durationLabel() }} visit</strong>
                    <small>All services scheduled in continuous sequence</small>
                  </div>
                </div>
                <label class="mode-toggle-label">
                  <input type="checkbox" [checked]="!continuousVisitMode()" (change)="toggleContinuousVisitMode()" />
                  <span>Book as separate appointments</span>
                </label>
              </div>

              @if (!continuousVisitMode() && bookingItems().length > 1) {
                <div class="booking-item-tabs" aria-label="Selected services">
                  @for (item of bookingItems(); track item.serviceId; let itemIndex = $index) {
                    @if (serviceById(item.serviceId); as service) {
                      <button type="button" [class.active]="activeItemIndex() === itemIndex" [class.done]="!!item.slotStartAt" (click)="setActiveItem(itemIndex)">
                        <span>{{ itemIndex + 1 }}</span>
                        <strong>{{ service.name }}</strong>
                        <small>{{ itemSlotLabel(itemIndex) || "Choose time" }}</small>
                      </button>
                    }
                  }
                </div>
              }

              <!-- Month Selector & 7 Visible Days Date Row -->
              <div class="calendar-container premium-card">
                <div class="month-selector-bar">
                  <button type="button" class="month-nav-btn" (click)="prevDatePage()" [disabled]="dateOffset() === 0" aria-label="Previous week">
                    <ion-icon name="chevron-back-outline" aria-hidden="true"></ion-icon>
                  </button>
                  <span class="month-title">{{ currentMonthLabel() }}</span>
                  <button type="button" class="month-nav-btn" (click)="nextDatePage()" aria-label="Next week">
                    <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                  </button>
                </div>

                <div class="date-row seven-days-grid">
                  @if (marketplace.loading() && !availabilityDays().length) {
                    @for (item of [1, 2, 3, 4, 5, 6, 7]; track item) {
                      <div class="date-card skeleton-date" aria-hidden="true">
                        <span class="skeleton-line short"></span>
                        <span class="skeleton-line"></span>
                        <span class="skeleton-line mini"></span>
                      </div>
                    }
                  } @else {
                    @for (date of visibleAvailabilityDays(); track date.date) {
                      <button
                        class="date-card"
                        [class.selected]="activeItem()?.date === date.date"
                        [class.full]="dateAvailabilityClass(date) === 'full'"
                        [attr.aria-label]="dateCardLabel(date)"
                        [attr.aria-pressed]="activeItem()?.date === date.date"
                        (click)="setDate(date.date)">
                        <span class="date-dot" [class]="dateAvailabilityClass(date)"></span>
                        <strong>{{ date.dayLabel }}</strong>
                        <span>{{ date.label }}</span>
                        <small class="status-text">{{ dateAvailabilityLabel(date) }}</small>
                      </button>
                    } @empty {
                      <section class="state-card stable-state"><h2>No slots available</h2></section>
                    }
                  }
                </div>
              </div>

              <!-- Quick Date & Time Shortcuts -->
              <div class="shortcuts-bar">
                <button type="button" class="shortcut-chip" (click)="selectNextAvailable()">
                  <ion-icon name="flash-outline" aria-hidden="true"></ion-icon> Next available
                </button>
                <button type="button" class="shortcut-chip" (click)="selectThisWeek()">
                  <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon> This week
                </button>
                @if (hasNoSlotsOnSelectedDate()) {
                  <button type="button" class="shortcut-chip waitlist-chip" (click)="joinWaitlist()">
                    Join waitlist for {{ selectedDateLabel() }}
                  </button>
                }
              </div>

              <!-- Generated Complete Visit Timeline (Immediately shown when selected) -->
              @if (continuousTimelineItems().length && allSlotsSelected()) {
                <section class="visit-timeline-card premium-card" aria-label="Generated Visit Timeline">
                  <div class="timeline-header">
                    <div>
                      <span class="timeline-badge">Complete Visit Timeline</span>
                      <strong>{{ continuousVisitTimeRangeLabel() }}</strong>
                      <small>Sequence total: {{ visitWindowDurationLabel() }} (incl. preparation/buffer)</small>
                    </div>
                    @if (slotHoldSeconds(); as seconds) {
                      <span class="hold-timer-badge" role="status">
                        ⏱️ Slot reserved: {{ formatHoldTimer(seconds) }}
                      </span>
                    }
                  </div>
                  <div class="timeline-sequence">
                    @for (stepItem of continuousTimelineItems(); track stepItem.serviceId; let idx = $index) {
                      <div class="timeline-step">
                        <span class="step-time">{{ stepItem.startTimeLabel }}–{{ stepItem.endTimeLabel }}</span>
                        <div class="step-details">
                          <strong>{{ stepItem.serviceName }}</strong>
                          <small>{{ stepItem.staffName }} · {{ stepItem.durationMinutes }} min</small>
                        </div>
                      </div>
                    }
                  </div>
                </section>
              }

              <!-- Expiration Warning Banner -->
              @if (slotExpiredWarning()) {
                <div class="slot-expired-card premium-card" role="alert">
                  <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
                  <div>
                    <strong>Slot expired or taken</strong>
                    <p>{{ slotExpiredWarning() }}</p>
                  </div>
                  <button type="button" class="shortcut-chip" (click)="selectNextAvailable()">Find nearest time</button>
                </div>
              }

              <!-- Section: Available Start Times -->
              <div class="section-subtitle-row">
                <h3>Available start times</h3>
                <small class="muted">Times shown are arrival/start times for your visit</small>
              </div>

              <!-- Alternatives Panel when continuous time is constrained -->
              @if (showAlternativesPanel() || showContinuousConflict()) {
                <div class="alternatives-card premium-card">
                  <h4>Looking for continuous timing?</h4>
                  <p class="muted">Selected staff members are not continuously available at some slots.</p>
                  <div class="alternatives-grid">
                    <button type="button" class="alt-btn" (click)="assignAnyStaffToAll()">
                      <strong>Same time with different professionals</strong>
                      <small>Switch to best available staff for back-to-back sequence</small>
                    </button>
                    <button type="button" class="alt-btn" (click)="selectNextAvailable()">
                      <strong>Later continuous time</strong>
                      <small>Jump to earliest continuous slot with current staff</small>
                    </button>
                    <button type="button" class="alt-btn" (click)="selectNextAvailableDate()">
                      <strong>Another date</strong>
                      <small>Jump to the next date with a valid continuous slot</small>
                    </button>
                    @if (otherBranches().length) {
                      <a class="alt-btn" [routerLink]="branchBookLink(otherBranches()[0])">
                        <strong>Another branch</strong>
                        <small>{{ otherBranches().length }} more branch{{ otherBranches().length === 1 ? "" : "es" }} nearby</small>
                      </a>
                    }
                    <label class="gap-toggle-label">
                      <input type="checkbox" [checked]="allowShortGap()" (change)="toggleAllowShortGap()" />
                      <span>Allow a short gap (10–15 min between services)</span>
                    </label>
                  </div>
                </div>
              }

              <div class="slot-sections">
                @if (marketplace.loading() && !slotGroups().length) {
                  <section class="slot-group premium-card skeleton-slot-group" aria-label="Loading time slots" aria-busy="true">
                    <span class="skeleton-line heading"></span>
                    <div class="slot-grid">
                      @for (item of [1, 2, 3, 4, 5, 6]; track item) {
                        <span class="slot skeleton-slot" aria-hidden="true"></span>
                      }
                    </div>
                  </section>
                } @else {
                  @for (group of slotGroups(); track group.label) {
                    <section class="slot-group premium-card" [class.collapsed]="isSlotGroupCollapsed(group.label)">
                      <button type="button" class="slot-group-header" (click)="toggleSlotGroup(group.label)">
                        <h3>{{ group.label }}</h3>
                        <ion-icon name="chevron-down-outline" aria-hidden="true"></ion-icon>
                      </button>
                      @if (!isSlotGroupCollapsed(group.label)) {
                        <div class="slot-grid">
                          @for (slot of group.slots; track slot.startAt) {
                            <button
                              class="slot"
                              [disabled]="!isSlotSelectable(slot)"
                              [class.selected]="isSlotStartSelected(slot)"
                              [attr.aria-pressed]="isSlotStartSelected(slot)"
                              (click)="selectActiveSlot(slot)">
                              {{ slot.displayTime }}
                            </button>
                          }
                        </div>
                      }
                    </section>
                  } @empty {
                    <section class="state-card premium-card stable-state">
                      <h2>No time slots available for {{ selectedDateLabel() }}</h2>
                      <p class="muted">Try selecting another date or join the waitlist.</p>
                      <button type="button" class="primary-gradient-btn" (click)="joinWaitlist()">Join waitlist</button>
                    </section>
                  }
                }
              </div>

              <!-- Your selected services / Visit Summary -->
              @if (scheduledServiceSummaries().length) {
                <section class="scheduled-services-card premium-card" aria-label="Current visit timeline">
                  <span>Your selected services & visit timeline</span>
                  <div>
                    @for (scheduled of scheduledServiceSummaries(); track scheduled.index) {
                      <div class="scheduled-service-row">
                        <strong>{{ scheduled.index + 1 }}. {{ scheduled.name }}</strong>
                        <small>{{ scheduled.time }} · {{ scheduled.staff }}</small>
                      </div>
                    }
                  </div>
                </section>
              }
            </section>
          }

          @if (currentBookingStep() === 4) {
            <section class="panel confirm-grid">
              <article class="premium-card confirm-card">
                <div class="confirm-card-header">
                  <h2>{{ isRescheduling() ? "Confirm your changes" : "Review & confirm booking" }}</h2>
                </div>

                <!-- Salon & Branch Details with Address & Map Icon -->
                <section class="review-salon-strip" aria-label="Salon details">
                  <div class="salon-info-row">
                    <span class="salon-mark">{{ business.businessName.slice(0, 1).toUpperCase() }}</span>
                    <div class="salon-copy">
                      <strong>{{ business.businessName }}</strong>
                      <span class="salon-address"><ion-icon name="location-outline" aria-hidden="true"></ion-icon> {{ business.address || (business.area + ', ' + business.city) }}</span>
                      <small class="salon-rating">
                        @if (heroRatingLabel() !== 'New salon') { ★ {{ heroRatingLabel() }} }
                        @else { <span class="tag-new">New salon</span> }
                      </small>
                    </div>
                  </div>
                </section>

                <!-- Review Section 1: Services (Chronological sequence & staff name directly beside/under service + Edit link) -->
                <section class="review-section" aria-label="Services section">
                  <div class="review-section-header">
                    <h3>Selected services ({{ selectedServices().length }})</h3>
                    <button type="button" class="btn-text-edit" (click)="goToStep(1)">Edit</button>
                  </div>
                  <div class="review-services-list">
                    @for (item of bookingItems(); track item.serviceId; let itemIndex = $index) {
                      @if (serviceById(item.serviceId); as service) {
                        <div class="review-service-item">
                          <span class="service-seq-num">{{ itemIndex + 1 }}</span>
                          <div class="review-service-details">
                            <strong class="service-name">{{ formatServiceName(service.name) }}</strong>
                            <span class="service-staff"><ion-icon name="person-outline" aria-hidden="true"></ion-icon> Professional: {{ itemStaffName(item) }}</span>
                            <span class="service-meta">{{ service.durationMinutes || 0 }} min · {{ money(service.pricePaise) }}</span>
                          </div>
                        </div>
                      }
                    }
                  </div>
                </section>

                <!-- Review Section 2: Professionals (+ Edit link) -->
                <section class="review-section" aria-label="Professionals section">
                  <div class="review-section-header">
                    <h3>Assigned professionals</h3>
                    <button type="button" class="btn-text-edit" (click)="goToStep(2)">Edit</button>
                  </div>
                  <div class="review-staff-summary">
                    @for (item of bookingItems(); track item.serviceId; let idx = $index) {
                      <div class="review-staff-chip">
                        <ion-icon name="person-outline" aria-hidden="true"></ion-icon>
                        <span>{{ serviceById(item.serviceId)?.name }}: <strong>{{ itemStaffName(item) }}</strong></span>
                      </div>
                    }
                  </div>
                </section>

                <!-- Review Section 3: Time & Validated Continuous Visit Timeline (+ Edit link) -->
                <section class="review-section" aria-label="Appointment time section">
                  <div class="review-section-header">
                    <h3>Date & visit schedule</h3>
                    <button type="button" class="btn-text-edit" (click)="goToStep(3)">Edit</button>
                  </div>

                  <div class="validated-timeline-box">
                    <div class="visit-date-badge">
                      <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
                      <strong>{{ selectedDateLabel() }}</strong>
                      @if (reviewVisitTimeRangeLabel()) { <span>· Visit Window: {{ reviewVisitTimeRangeLabel() }}</span> }
                    </div>

                    @if (reviewTimelineItems().length) {
                      <div class="validated-timeline-sequence">
                        @for (stepItem of reviewTimelineItems(); track stepItem.startIso; let idx = $index) {
                          <div class="validated-step">
                            <span class="step-num-badge">{{ idx + 1 }}</span>
                            <span class="step-time-window">{{ stepItem.startTimeLabel }}–{{ stepItem.endTimeLabel }}</span>
                            <span class="step-name">{{ stepItem.serviceName }}</span>
                            <small class="step-staff">({{ stepItem.staffName }})</small>
                          </div>
                        }
                      </div>
                    }
                  </div>
                </section>

                <!-- Optional Customer Note Section -->
                <section class="review-section" aria-label="Special requests">
                  <div class="review-section-header">
                    <h3>Customer notes & requests <small>(optional)</small></h3>
                  </div>
                  <textarea
                    class="customer-note-input"
                    rows="2"
                    [value]="customerNote()"
                    (input)="onCustomerNoteInput($event)"
                    placeholder="Add allergies, preferences, or special instructions...">
                  </textarea>
                </section>

                <!-- Apply Benefits & Coupon Entry -->
                <section class="review-section" aria-label="Offers and benefits">
                  <div class="review-section-header">
                    <h3>Benefits & coupons</h3>
                  </div>
                  <div class="benefits-container">
                    <div class="benefits-row">
                      <ion-icon name="sparkles-outline" aria-hidden="true"></ion-icon>
                      <span>Apply membership or package benefits</span>
                      <button type="button" class="btn-text-secondary" (click)="toggleApplyBenefits()">{{ benefitsApplied() ? "Remove" : "Apply" }}</button>
                    </div>
                    <div class="coupon-row">
                      <input type="text" class="coupon-input" [value]="couponCode()" (input)="onCouponInput($event)" placeholder="Enter offer / promo code" />
                      <button type="button" class="btn-apply-coupon" (click)="applyCoupon()">Apply</button>
                    </div>
                    @if (couponSuccessMsg()) { <p class="coupon-msg success">{{ couponSuccessMsg() }}</p> }
                  </div>
                </section>

                <!-- Cancellation & Rescheduling Policies -->
                <section class="review-section policy-section" aria-label="Policies">
                  <div class="policy-item">
                    <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
                    <div>
                      <strong>Cancellation Policy</strong>
                      <p>Free cancellation up to 2 hours before appointment. <button type="button" class="policy-link-btn" (click)="showPolicyModal.set(true)">View policy</button></p>
                    </div>
                  </div>
                  <div class="policy-item">
                    <ion-icon name="time-outline" aria-hidden="true"></ion-icon>
                    <div>
                      <strong>Rescheduling Policy</strong>
                      <p>Free rescheduling available up to 1 hour before start time.</p>
                    </div>
                  </div>
                </section>

                <!-- Dedicated Payment & Price Summary Section -->
                <section class="review-section price-summary-section" aria-label="Price summary">
                  <h3>Price summary</h3>
                  <div class="price-summary-box">
                    <div class="price-row"><span>Service subtotal</span><strong>{{ totalPriceLabel() }}</strong></div>
                    @if (discountPaise() > 0) {
                      <div class="price-row discount-row"><span>Coupon / offer discount</span><strong>− {{ money(discountPaise()) }}</strong></div>
                    }
                    <div class="price-row"><span>Taxes & fees</span><strong>₹0</strong></div>
                    <div class="price-row"><span>Online deposit required</span><strong>₹0</strong></div>
                    <div class="price-row final-total-row">
                      <div>
                        <strong>Total payable at salon</strong>
                        <small>No online payment required</small>
                      </div>
                      <strong class="final-amount">{{ finalPayableLabel() }}</strong>
                    </div>
                  </div>
                </section>
              </article>
            </section>
          }
        </main>

        <div class="booking-cta sticky-cta">
        <div class="bottom-action-card">
          @if (currentBookingStep() === 2) {
            <p class="assign-status" role="status">{{ assignStatusLabel() }}</p>
          } @else if (currentBookingStep() === 4) {
            <p class="assign-status final-pay-note" role="status">
              <span class="pay-amount-highlight">{{ finalPayableLabel() }}</span> · No online payment required
            </p>
          }
          <div class="assign-footer-row">
            <button type="button" class="booking-summary-metrics" aria-label="Review selected services" (click)="selectionsOpen.set(true)">
              <span class="summary-row">
                <small>Services</small>
                <strong>{{ serviceCountLabel() }}</strong>
              </span>
              <span class="summary-row">
                <small>Duration</small>
                <strong>{{ currentBookingStep() === 4 ? reviewWindowDurationLabel() : durationLabel() }}</strong>
              </span>
              <span class="summary-row summary-total">
                <small>Total</small>
                <strong>{{ totalPriceLabel() }}</strong>
              </span>
            </button>
            @if (currentBookingStep() < 4) {
              <ion-button class="primary-gradient" [disabled]="!canContinue() || !!slotExpiredWarning()" (click)="next()">Continue</ion-button>
            } @else {
              <ion-button class="primary-gradient" [disabled]="!canConfirm() || marketplace.loading()" (click)="confirmBooking()">
                  @if (marketplace.loading()) { <span class="button-spinner" aria-hidden="true"></span> }
                  <span>{{ isRescheduling() ? "Save changes" : (marketplace.isAuthenticated() ? "Confirm booking" : "Sign in to book") }}</span>
              </ion-button>
            }
            </div>
          </div>
        </div>

        @if (showPolicyModal()) {
          <div class="drawer-backdrop" (click)="showPolicyModal.set(false)"></div>
          <aside class="selections-drawer policy-modal" role="dialog" aria-modal="true">
            <header class="drawer-header">
              <h2>Cancellation & Salon Policies</h2>
              <button type="button" class="drawer-done" (click)="showPolicyModal.set(false)">Close</button>
            </header>
            <div class="policy-modal-body">
              <h4>Cancellation Policy</h4>
              <p>Cancellations made 2 or more hours prior to appointment time are fully free. Cancellations within 2 hours may incur a partial fee on future bookings.</p>
              <h4>Rescheduling Policy</h4>
              <p>You can reschedule your appointment free of charge up to 1 hour before start time via the Aura Customer App.</p>
              <h4>Venue Payment</h4>
              <p>No deposit or payment is required now. Please pay full amount at salon after service completion.</p>
            </div>
          </aside>
        }

        @if (selectionsOpen()) {
          <div class="drawer-backdrop" (click)="selectionsOpen.set(false)"></div>
          <aside class="selections-drawer" role="dialog" aria-modal="true" aria-label="Selected services">
            <header class="drawer-header">
              <h2>Selected services</h2>
              <button type="button" class="drawer-done" (click)="selectionsOpen.set(false)">Done</button>
            </header>
            <ul class="drawer-list">
              @for (item of bookingItems(); track item.serviceId) {
                @if (serviceById(item.serviceId); as service) {
                  <li class="drawer-item">
                    <span class="drawer-item-copy">
                      <strong>{{ formatServiceName(service.name) }}</strong>
                      <small>{{ service.durationMinutes || 0 }} min · {{ money(service.pricePaise) }}</small>
                    </span>
                    <button type="button" class="drawer-remove" (click)="toggleService(item.serviceId)" [attr.aria-label]="'Remove ' + service.name">Remove</button>
                  </li>
                }
              } @empty {
                <li class="drawer-empty">No services selected yet.</li>
              }
            </ul>
          </aside>
        }
        } @else {
          <main class="page-narrow">
            <section class="recovery-card premium-card" role="status">
              <div class="recovery-icon" aria-hidden="true"><ion-icon name="storefront-outline"></ion-icon></div>
              <h1>Online booking is not available for this branch</h1>
              <p>This salon isn't accepting online bookings right now. Call or message them to schedule your visit, or explore other salons nearby.</p>

              @if (contactPhone(); as phone) {
                <div class="recovery-actions">
                  <a class="recovery-action recovery-action-primary" [href]="'tel:' + phone"><ion-icon name="call-outline" aria-hidden="true"></ion-icon> Call salon</a>
                  <a class="recovery-action recovery-action-primary" [href]="'sms:' + phone"><ion-icon name="chatbubble-outline" aria-hidden="true"></ion-icon> Message salon</a>
                </div>
              }

              @if (otherBranches().length) {
                <div class="recovery-branches" aria-label="Other branches that accept bookings">
                  <h2>Book at another branch</h2>
                  @for (branch of otherBranches(); track branch.branchId || branch.id) {
                    <a class="recovery-branch" [routerLink]="branchBookLink(branch)">
                      <span class="recovery-branch-mark">{{ branch.businessName.slice(0, 1).toUpperCase() }}</span>
                      <span class="recovery-branch-copy">
                        <strong>{{ branch.businessName }}</strong>
                        <small>{{ branch.area || branch.city || 'Location details' }} · {{ branch.isOpen ? 'Open' : 'Closed' }}</small>
                      </span>
                      <ion-icon name="chevron-forward-outline" aria-hidden="true"></ion-icon>
                    </a>
                  }
                </div>
              }

              <div class="recovery-footer">
                <a class="recovery-action" [routerLink]="exploreHref()"><ion-icon name="search-outline" aria-hidden="true"></ion-icon> Explore similar salons</a>
                <button type="button" class="recovery-back" (click)="goBack()"><ion-icon name="arrow-back-outline" aria-hidden="true"></ion-icon> Choose another salon</button>
              </div>
            </section>
          </main>
        }
      } @else {
        <main class="page-narrow">
          @if (marketplace.loading()) {
            <section class="state-card premium-card booking-flow-skeleton" aria-label="Loading booking flow" aria-busy="true">
              <span class="skeleton-line title"></span>
              <span class="skeleton-line wide"></span>
              <span class="skeleton-line"></span>
              <div class="slot-grid">
                @for (item of [1, 2, 3, 4, 5, 6]; track item) {
                  <span class="slot skeleton-slot" aria-hidden="true"></span>
                }
              </div>
            </section>
          } @else {
            <section class="state-card premium-card error"><h1>Booking unavailable</h1><p>{{ marketplace.error() || "The business could not be loaded." }}</p><ion-button class="primary-gradient" (click)="reload()">Retry</ion-button></section>
          }
        </main>
      }
    </ion-content>
  `,
  styles: [`
    :host { --booking-footer-height: 108px; --booking-footer-gap: 16px; }
    .booking-page { max-width: 980px; padding-bottom: calc(var(--booking-footer-height) + var(--booking-footer-gap) + env(safe-area-inset-bottom)); }
    .edit-toolbar-title {
      padding-inline: 0 16px;
      color: var(--text);
      text-align: left;
      font-size: 1.08rem;
      font-weight: 900;
      letter-spacing: -0.025em;
    }
    .booking-page.editing { padding-top: 8px; }
    .booking-page.editing app-booking-progress { display: block; margin-top: 2px; }
    .booking-cta { width: min(980px, calc(100% - 24px)); margin: 0 auto; }
    .booking-cta.sticky-cta { bottom: calc(8px + env(safe-area-inset-bottom)); }
    .booking-cta .bottom-action-card { min-height: var(--booking-footer-height); display: grid; grid-template-columns: 1fr; grid-template-rows: auto 1fr; align-items: center; gap: 8px; padding: 12px; overflow: hidden; }
    .assign-footer-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
    .assign-status { margin: 0; color: var(--muted); font-size: 0.76rem; font-weight: 850; letter-spacing: 0.02em; }
    .booking-summary-metrics { min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, auto)); gap: 14px; align-items: center; padding: 6px; border: 0; border-radius: 14px; background: transparent; color: var(--text); text-align: left; }
    .booking-summary-metrics:hover, .booking-summary-metrics:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.35); outline-offset: 2px; }
    .summary-row { min-width: 0; display: grid; gap: 2px; }
    .summary-row small { overflow: hidden; color: var(--muted); font-size: 0.6rem; font-weight: 950; letter-spacing: 0.08em; line-height: 1.1; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
    .summary-row strong { overflow: hidden; color: var(--text); font-size: 0.88rem; font-weight: 950; line-height: 1.15; text-overflow: ellipsis; white-space: nowrap; }
    .summary-row.summary-total strong { color: var(--primary); }
    .booking-cta .bottom-action-card ion-button { min-width: 128px; height: 48px; margin: 0; }
    .button-spinner { width: 16px; height: 16px; display: inline-block; margin-right: 8px; border: 2px solid rgba(255,255,255,.5); border-top-color: #fff; border-radius: 999px; animation: button-spin 700ms linear infinite; vertical-align: -3px; }
    .booking-hero { display: grid; gap: 4px; align-items: center; padding: 16px; }
    .booking-hero .page-title { font-size: clamp(1.45rem, 4vw, 2.7rem); }
    .edit-context-card { display: grid; gap: 4px; padding: 12px 16px; border-color: rgba(99, 102, 241, 0.24); background: var(--primary-soft); }
    .edit-context-card span { color: var(--primary); font-size: 0.76rem; font-weight: 900; }
    .edit-context-card strong, .edit-context-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .edit-context-card strong { color: var(--text); font-size: 0.96rem; }
    .edit-context-card small { color: var(--muted); font-size: 0.82rem; font-weight: 800; }
    .booking-intent-row, .resource-grid, .time-mode-row { display: grid; gap: 10px; margin-bottom: 14px; }
    .booking-intent-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .booking-intent-row button, .resource-grid button, .time-mode-row button { border: 1px solid var(--border); border-radius: 18px; color: var(--text); background: var(--surface); box-shadow: var(--shadow-soft); font-weight: 900; }
    .booking-intent-row button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 10px; align-items: center; padding: 14px; text-align: left; }
    .booking-intent-row button.active, .resource-grid button.active, .time-mode-row button.active, .addon-grid button.active { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .booking-intent-row button:disabled, .resource-grid button:disabled, .time-mode-row button:disabled, .addon-grid button:disabled { cursor: not-allowed; opacity: 0.58; }
    .booking-intent-row ion-icon { grid-row: span 2; font-size: 1.25rem; }
    .booking-intent-row small, .resource-grid small { color: inherit; opacity: 0.72; line-height: 1.35; }
    .readiness-note, .addon-panel, .resource-panel { display: grid; gap: 8px; padding: 16px; margin-bottom: 14px; }
    .readiness-note { border-color: rgba(99, 102, 241, 0.22); background: var(--primary-soft); }
    .readiness-note strong, .readiness-note span, .addon-panel small, .resource-panel small { line-height: 1.45; }
    .readiness-note span, .addon-panel small, .resource-panel small { color: var(--muted); }
    .addon-panel h3, .resource-panel h3 { margin: 0; letter-spacing: 0; }
    .addon-grid { display: grid; gap: 8px; }
    .addon-grid button { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 16px; color: var(--text); background: var(--surface); font-weight: 900; }
    .addon-grid button strong { color: inherit; }
    .resource-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .resource-grid button { display: grid; gap: 4px; justify-items: start; padding: 13px; text-align: left; }
    .resource-grid ion-icon { font-size: 1.25rem; }
    .time-mode-row { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .time-mode-row button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 46px; padding: 10px; }
    .service-list, .staff-list, .slot-sections { display: grid; gap: 12px; }
    .service-choice, .staff-choice { width: 100%; display: grid; gap: 12px; align-items: center; padding: 16px; border-color: var(--border); color: var(--text); text-align: left; }
    .service-choice { grid-template-columns: minmax(0, 1fr) auto; align-items: center; min-height: 76px; gap: 12px; padding: 12px; transition: none; }
    .service-choice-copy { min-width: 0; display: grid; gap: 4px; }
    .service-choice-side { display: grid; justify-items: end; gap: 8px; color: inherit; }
    .choice-action { min-width: 72px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border: 1px solid rgba(99, 102, 241, 0.24); border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.8rem; font-weight: 950; }
    .service-choice.selected .choice-action { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .service-choice.selected, .staff-choice.selected { border-color: rgba(99, 102, 241, 0.48); background: var(--primary-soft); box-shadow: 0 12px 24px rgba(99, 102, 241, 0.12); }
    .service-choice h3 { margin: 0 0 4px; font-size: 1.06rem; letter-spacing: -0.035em; line-height: 1.15; }
    .service-choice p { display: -webkit-box; margin: 0; overflow: hidden; color: var(--muted); font-size: 0.82rem; line-height: 1.3; -webkit-box-orient: vertical; -webkit-line-clamp: 1; }
    .service-choice-copy span { color: var(--muted); font-size: 0.78rem; font-weight: 800; }
    .service-choice strong { color: var(--primary); font-size: 0.92rem; }
    .staff-choice { position: relative; grid-template-columns: auto minmax(0, 1fr) auto; min-height: 76px; gap: 10px; padding: 12px 14px; transition: none; }
    .staff-choice.selected { outline: 2px solid rgba(99, 102, 241, 0.28); outline-offset: 2px; }
    .staff-choice img, .any-avatar { width: 54px; height: 54px; border-radius: 18px; object-fit: cover; }
    .any-avatar { display: grid; place-items: center; color: #FFFFFF; background: var(--primary); font-size: 1.35rem; }
    .staff-choice strong { display: block; line-height: 1.15; }
    .staff-choice span, .staff-choice em { display: block; color: var(--muted); font-style: normal; line-height: 1.25; }
    .staff-choice em { min-width: 68px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.78rem; font-weight: 900; text-align: center; }
    .staff-choice.selected em { color: #FFFFFF; background: var(--primary); }
    .check-slots-button { justify-self: end; min-height: 40px; padding: 0 13px; border: 1px solid rgba(99, 102, 241, 0.32); border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.8rem; font-weight: 900; white-space: nowrap; }
    .check-slots-button:hover, .check-slots-button:focus-visible { background: var(--gold-soft); }
    .multi-service-stack { display: grid; gap: 14px; }
    .service-schedule-card { display: grid; gap: 12px; padding: 16px; }
    .service-schedule-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .service-schedule-head h3 { margin: 0 0 3px; font-size: 1rem; letter-spacing: -0.025em; }
    .service-schedule-head small { color: var(--muted); font-weight: 850; }
    .service-schedule-head > span { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; color: #FFFFFF; background: var(--primary); font-weight: 950; }
    .schedule-context-card { position: sticky; top: 78px; z-index: 16; display: grid; gap: 4px; align-items: center; margin-bottom: 12px; padding: 12px 14px; border-color: rgba(99, 102, 241, 0.24); background: var(--glass); backdrop-filter: blur(14px); }
    .schedule-context-count span { color: var(--primary); font-size: 0.76rem; font-weight: 900; line-height: 1.2; }
    .schedule-context-copy { min-width: 0; display: grid; gap: 3px; }
    .schedule-context-copy strong, .schedule-context-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .schedule-context-copy strong { color: var(--text); font-size: 1rem; line-height: 1.12; }
    .schedule-context-copy span { color: var(--muted); font-size: 0.82rem; font-weight: 800; }
    .scheduled-services-card { display: grid; gap: 8px; margin-bottom: 12px; padding: 12px; }
    .scheduled-services-card > span { color: var(--muted); font-size: 0.68rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .scheduled-services-card > div { display: grid; gap: 7px; }
    .scheduled-services-card button { display: grid; grid-template-columns: minmax(0, 1fr); gap: 2px; min-height: 48px; padding: 9px 10px; border: 1px solid var(--border); border-radius: 14px; color: var(--text); background: var(--surface); text-align: left; }
    .scheduled-services-card button.active { border-color: rgba(99, 102, 241, 0.4); background: var(--primary-soft); }
    .scheduled-services-card strong, .scheduled-services-card small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .scheduled-services-card strong { font-size: 0.82rem; }
    .scheduled-services-card small { color: var(--muted); font-size: 0.74rem; font-weight: 800; }
    .staff-list.compact { gap: 8px; }
    .staff-list.compact .staff-choice { min-height: 68px; padding: 9px 10px; border-radius: 16px; }
    .staff-list.compact .staff-choice img, .staff-list.compact .any-avatar { width: 42px; height: 42px; border-radius: 14px; }
    .booking-item-tabs { display: grid; gap: 8px; margin-bottom: 14px; }
    .booking-item-tabs button { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: center; padding: 12px; border: 1px solid var(--border); border-radius: 16px; color: var(--text); background: var(--surface); text-align: left; box-shadow: var(--shadow-soft); }
    .booking-item-tabs button > span { grid-row: span 2; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-weight: 950; }
    .booking-item-tabs button strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .booking-item-tabs button small { color: var(--muted); font-weight: 800; }
    .booking-item-tabs button.active { border-color: rgba(99, 102, 241, 0.44); background: var(--primary-soft); }
    .booking-item-tabs button.done > span { color: #059669; background: #D1FAE5; }
    .selected-staff-card { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 12px; align-items: center; margin-bottom: 14px; padding: 14px 16px; border-color: rgba(99, 102, 241, 0.28); background: var(--primary-soft); }
    .selected-staff-card span, .selected-staff-card small { display: block; color: var(--muted); line-height: 1.35; }
    .selected-staff-card span { font-size: 0.78rem; font-weight: 900; letter-spacing: 0; }
    .selected-staff-card strong { display: block; margin-top: 3px; color: var(--text); font-size: 1.02rem; font-weight: 900; }
    .selected-staff-card small { margin-top: 2px; font-weight: 800; }
    .selected-staff-card .selected-slot-note { color: var(--primary); }
    .date-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(98px, 1fr); gap: 8px; overflow-x: auto; padding: 2px 1px 12px; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .date-row::-webkit-scrollbar { display: none; }
    .date-card, .slot { border: 1px solid var(--border); border-radius: 18px; background: var(--surface); color: var(--text); font-weight: 900; }
    .date-card { position: relative; display: grid; gap: 4px; justify-items: center; min-height: 78px; padding: 12px 10px 10px; overflow: hidden; scroll-snap-align: start; }
    .date-card.selected { color: #FFFFFF; border-color: transparent; background: var(--primary); box-shadow: 0 10px 24px rgba(99, 102, 241, 0.16); }
    .date-card.selected span { color: rgba(255,255,255,.82); }
    .date-card:disabled { color: var(--muted); border-color: var(--border); background: var(--surface-soft); opacity: .58; box-shadow: none; }
    .date-card strong { line-height: 1.05; }
    .date-card span { color: var(--muted); font-size: 0.78rem; line-height: 1.05; }
    .date-card em { display: none; }
    .skeleton-line { display: block; width: 100%; height: 12px; border-radius: 999px; background: linear-gradient(90deg, rgba(232, 232, 232, 0.92), rgba(244, 244, 242, 0.98), rgba(232, 232, 232, 0.92)); background-size: 220% 100%; animation: booking-skeleton 1.15s ease-in-out infinite; }
    .skeleton-line.title { width: min(260px, 75%); height: 28px; border-radius: 12px; }
    .skeleton-line.heading { width: 112px; height: 18px; margin-bottom: 12px; border-radius: 10px; }
    .skeleton-line.wide { width: min(520px, 100%); }
    .skeleton-line.short { width: 58%; }
    .skeleton-line.mini { width: 42%; height: 9px; }
    .date-card.skeleton-date { min-height: 89px; align-content: center; gap: 8px; pointer-events: none; }
    .slot-group, .state-card { padding: 16px; }
    .slot-group h3, .state-card h2, .state-card h1 { margin: 0 0 12px; letter-spacing: -0.035em; }
    .state-card.error p { color: #EF4444; }
    .flow-warning { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.1); }
    .flow-warning h2 { color: var(--text); }
    .flow-warning p { margin: 0; }
    .state-card.stable-state { min-height: 96px; display: grid; align-content: center; }
    .booking-flow-skeleton { min-height: 320px; display: grid; align-content: start; gap: 14px; }
    .skeleton-slot-group { min-height: 158px; }
    .slot-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .slot { min-height: 46px; display: inline-flex; align-items: center; justify-content: center; padding: 0 8px; border-color: var(--border); color: var(--text); background: var(--surface); font-size: 0.9rem; line-height: 1; transition: none; }
    .slot:not(:disabled):not(.selected):hover, .slot:not(:disabled):not(.selected):focus-visible { border-color: rgba(99, 102, 241, 0.42); }
    .slot.skeleton-slot { min-height: 45px; border-color: transparent; background: linear-gradient(90deg, rgba(232, 232, 232, 0.92), rgba(244, 244, 242, 0.98), rgba(232, 232, 232, 0.92)); background-size: 220% 100%; animation: booking-skeleton 1.15s ease-in-out infinite; pointer-events: none; }
    .slot.selected { position: relative; color: #FFFFFF; border-color: transparent; background: var(--primary); box-shadow: 0 14px 28px rgba(99, 102, 241, 0.22); text-decoration: none; opacity: 1; }
    .slot.selected::after { content: none; }
    .slot:disabled:not(.selected) { color: rgba(71, 85, 105, 0.8); border-color: rgba(148, 163, 184, 0.6); border-style: dashed; background: var(--surface-soft); text-decoration: line-through; text-decoration-thickness: 1.5px; text-decoration-color: rgba(148, 163, 184, 0.65); box-shadow: none; cursor: not-allowed; }
    .confirm-grid { display: grid; gap: 12px; }
    .confirm-card, .trust-card { padding: 16px; }
    .confirm-card h2, .trust-card h3 { margin: 0 0 10px; letter-spacing: -0.04em; }
    .review-group { display: grid; gap: 10px; padding-top: 12px; margin-top: 12px; border-top: 1px solid var(--border); }
    .review-priority-group { padding-top: 0; margin-top: 0; border-top: 0; }
    .review-group h3 { margin: 0; color: var(--muted); font-size: 0.74rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .review-summary-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .review-summary-strip span { min-width: 0; display: grid; gap: 3px; padding: 11px 10px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
    .review-summary-strip small { color: var(--muted); font-size: 0.64rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .review-summary-strip strong { overflow: hidden; color: var(--text); font-size: 0.92rem; font-weight: 950; line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
    .review-summary-strip .review-total { border-color: rgba(99, 102, 241, 0.34); background: var(--primary-soft); }
    .review-summary-strip .review-total strong { color: var(--primary); font-size: 1.08rem; }
    dl { display: grid; gap: 2px; margin: 0; }
    dl div { display: flex; justify-content: space-between; gap: 18px; padding: 10px 0; border-bottom: 1px solid var(--border); }
    dt { color: var(--muted); font-weight: 800; }
    dd { margin: 0; font-weight: 900; text-align: right; }
    .trust-card { display: grid; gap: 6px; align-content: start; }
    .trust-card ion-icon { color: #10B981; font-size: 1.55rem; }
    .trust-card h3 { margin-bottom: 0; }
    .trust-card p { margin: 0; color: var(--muted); line-height: 1.38; }
      .sticky-cta { bottom: calc(24px + env(safe-area-inset-bottom)); }
      .sticky-cta--confirm { bottom: calc(8px + env(safe-area-inset-bottom)); }
    @media (max-width: 599px) {
      .booking-page { padding-bottom: calc(var(--booking-footer-height) + 24px + env(safe-area-inset-bottom)); }

      .sticky-cta { bottom: calc(10px + env(safe-area-inset-bottom)); }

      .sticky-cta--confirm {
        bottom: calc(2px + env(safe-area-inset-bottom));
      }

      .booking-cta { width: min(100% - 16px, 980px); }
      .booking-cta .bottom-action-card { min-height: var(--booking-footer-height); gap: 6px; padding: 12px; border-radius: 20px; }
      .assign-footer-row { gap: 8px; }
      .booking-summary-metrics { gap: 10px; }
      .booking-summary-metrics strong { font-size: 0.78rem; }
      .summary-row small { font-size: 0.54rem; }

      .booking-cta .bottom-action-card ion-button { min-width: 112px; height: 44px; }

      .booking-intent-row, .resource-grid, .time-mode-row { grid-template-columns: 1fr; }
      .service-list { gap: 8px; }
      .service-choice { grid-template-columns: minmax(0, 1fr) auto; min-height: 72px; gap: 8px; padding: 10px 12px; border-radius: 18px; }
      .service-choice h3 { margin-bottom: 3px; font-size: 0.98rem; line-height: 1.12; }
      .service-choice p { margin-bottom: 6px; font-size: 0.82rem; line-height: 1.28; }
      .service-choice strong { font-size: 0.84rem; }
      .choice-action { min-width: 64px; min-height: 34px; padding-inline: 10px; font-size: 0.76rem; }
      .staff-choice { grid-template-columns: 44px minmax(0, 1fr) auto; min-height: 64px; gap: 9px; padding: 9px 10px; }
      .staff-choice img, .any-avatar { width: 44px; height: 44px; border-radius: 14px; }
      .staff-choice strong { font-size: 0.92rem; }
      .staff-choice span { font-size: 0.78rem; }
      .staff-choice em { font-size: 0.72rem; text-align: right; }
      .check-slots-button { justify-self: end; min-height: 38px; padding-inline: 10px; font-size: 0.74rem; }
      .schedule-context-card { gap: 4px; padding: 10px 12px; border-radius: 18px; }
      .schedule-context-copy strong { font-size: 0.92rem; }
      .schedule-context-copy span { font-size: 0.76rem; }
      .scheduled-services-card { padding: 10px; }
      .scheduled-services-card button { min-height: 44px; padding: 8px 9px; }
      .date-row { grid-auto-columns: minmax(88px, 31%); gap: 7px; }
      .date-card { min-height: 76px; padding: 11px 8px 9px; border-radius: 16px; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
      .slot { min-height: 44px; font-size: 0.84rem; }
      .confirm-card, .trust-card { padding: 14px; }
      .review-summary-strip { gap: 6px; }
      .review-summary-strip span { padding: 9px 8px; border-radius: 14px; }
      .review-summary-strip small { font-size: 0.56rem; }
      .review-summary-strip strong { font-size: 0.78rem; }
      .review-summary-strip .review-total strong { font-size: 0.94rem; }
      dl div { padding: 9px 0; gap: 10px; }
    }
    @media (max-width: 430px) {
      .schedule-context-card { top: 72px; }
      .service-search { top: 72px; }
    }
    @media (min-width: 768px) {
      .booking-hero { grid-template-columns: 180px minmax(0, 1fr); }
      .staff-choice em { text-align: left; }
      .check-slots-button { justify-self: start; }
      .slot-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .multi-staff-quick-bar { margin-bottom: 12px; }
    .quick-staff-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px solid rgba(99, 102, 241, 0.28); border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.84rem; font-weight: 900; }
    .multi-service-progress-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; margin-bottom: 12px; border: 1px solid rgba(99, 102, 241, 0.24); border-radius: 18px; color: var(--text); background: var(--primary-soft); }
    .multi-service-progress-banner p { margin: 0; font-size: 0.88rem; }
    .multi-service-progress-banner small { opacity: 0.88; font-weight: 850; font-size: 0.78rem; }
    .confirm-service-row { display: grid !important; grid-template-columns: minmax(0, 1fr) auto !important; align-items: start !important; gap: 8px !important; }
    .confirm-service-row dt { display: grid; gap: 2px; text-align: left; }
    .confirm-service-row dt .step-num { width: 22px; height: 22px; display: inline-grid; place-items: center; border-radius: 999px; color: #fff; background: var(--primary); font-size: 0.72rem; font-weight: 950; margin-right: 6px; }
    .confirm-service-row dd { display: grid; gap: 4px; justify-items: end; text-align: right; font-size: 0.84rem; }
    .confirm-service-row dd ion-icon { vertical-align: middle; margin-right: 2px; }
    .recovery-card { max-width: 560px; display: grid; gap: 14px; justify-items: center; padding: 28px 20px; margin: 24px auto; text-align: center; }
    .recovery-icon { width: 64px; height: 64px; display: grid; place-items: center; border-radius: 22px; color: var(--primary); background: var(--primary-soft); font-size: 1.9rem; }
    .recovery-card h1 { margin: 0; font-size: clamp(1.3rem, 3.6vw, 1.8rem); letter-spacing: -0.03em; line-height: 1.2; }
    .recovery-card p { margin: 0; max-width: 42ch; color: var(--muted); line-height: 1.5; }
    .recovery-actions { width: 100%; max-width: 400px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .recovery-action { min-height: 48px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--surface); font-size: 0.9rem; font-weight: 900; }
    .recovery-action ion-icon { font-size: 1.05rem; }
    .recovery-action-primary { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .recovery-action:hover, .recovery-action:focus-visible, .recovery-back:hover, .recovery-back:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.4); outline-offset: 2px; }
    .recovery-branches { width: 100%; display: grid; gap: 8px; text-align: left; }
    .recovery-branches h2 { margin: 6px 0 0; color: var(--muted); font-size: 0.74rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .recovery-branch { min-height: 56px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--border); border-radius: 16px; color: var(--text); background: var(--surface); text-align: left; }
    .recovery-branch-mark { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 12px; color: #FFFFFF; background: var(--primary); font-size: 0.9rem; font-weight: 950; }
    .recovery-branch-copy { min-width: 0; display: grid; gap: 2px; }
    .recovery-branch-copy strong, .recovery-branch-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .recovery-branch-copy small { color: var(--muted); font-size: 0.78rem; font-weight: 800; }
    .recovery-branch ion-icon { color: var(--muted); }
    .recovery-footer { width: 100%; display: grid; gap: 12px; justify-items: center; }
    .recovery-back { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border: 0; color: var(--primary); background: transparent; font-size: 0.88rem; font-weight: 950; }
    @media (max-width: 420px) {
      .recovery-actions { grid-template-columns: 1fr; }
    }
    .service-panel { display: grid; gap: 12px; }
    .service-search { position: sticky; top: 78px; z-index: 15; display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 14px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
    .service-search ion-icon { color: var(--muted); font-size: 1.1rem; }
    .service-search input { min-width: 0; flex: 1; border: 0; outline: 0; color: var(--text); background: transparent; font: inherit; font-size: 0.95rem; -webkit-appearance: none; appearance: none; }
    .service-search input::placeholder { color: var(--muted); }
    .category-chips { display: flex; gap: 8px; overflow-x: auto; padding: 2px 1px 6px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .category-chips::-webkit-scrollbar { display: none; }
    .category-chip { flex: 0 0 auto; min-height: 38px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--surface); font-size: 0.84rem; font-weight: 900; white-space: nowrap; }
    .category-chip.active { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .service-group { display: grid; gap: 8px; }
    .group-header { display: inline-flex; align-items: center; gap: 8px; padding: 4px 2px; border: 0; color: var(--text); background: transparent; font: inherit; text-align: left; }
    .group-title { font-size: 0.78rem; font-weight: 950; letter-spacing: 0.08em; text-transform: uppercase; }
    .group-count { min-width: 22px; min-height: 22px; display: grid; place-items: center; padding: 0 6px; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.72rem; font-weight: 950; }
    .group-header ion-icon { color: var(--muted); font-size: 1rem; transition: transform 180ms ease; }
    .service-group.collapsed .group-header ion-icon { transform: rotate(-90deg); }
    .service-card { display: grid; gap: 8px; min-height: 108px; align-content: center; padding: 12px 14px; border-color: var(--border); }
    .service-card.selected { border-color: rgba(99, 102, 241, 0.5); background: var(--primary-soft); box-shadow: 0 12px 24px rgba(99, 102, 241, 0.1); }
    .service-card.expanded { border-color: rgba(99, 102, 241, 0.34); }
    .service-card-main { display: grid; gap: 6px; width: 100%; padding: 0; border: 0; color: var(--text); background: transparent; font: inherit; text-align: left; }
    .service-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .service-name { font-size: 1.02rem; font-weight: 950; letter-spacing: -0.03em; line-height: 1.2; }
    .service-price-row { display: flex; align-items: baseline; gap: 10px; }
    .service-price-row strong { color: var(--primary); font-size: 0.9rem; font-weight: 950; }
    .service-price-row span { color: var(--muted); font-size: 0.88rem; font-weight: 850; }
    .service-desc { display: -webkit-box; overflow: hidden; color: var(--muted); font-size: 0.82rem; line-height: 1.35; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .offer-pill.extended { color: var(--muted); border-color: var(--border); background: var(--surface-soft); }
    .service-card-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .service-eligibility { min-width: 0; overflow: hidden; color: var(--muted); font-size: 0.76rem; font-weight: 800; text-overflow: ellipsis; white-space: nowrap; }
    .add-service-btn { min-width: 84px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 16px; border: 1.5px solid rgba(99, 102, 241, 0.45); border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.84rem; font-weight: 950; }
    .add-service-btn.added { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .add-service-btn:hover, .add-service-btn:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.4); outline-offset: 2px; }
    .service-details { display: grid; gap: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
    .service-details p { margin: 0; color: var(--muted); font-size: 0.85rem; line-height: 1.45; }
    .service-details dl { display: grid; gap: 2px; margin: 0; }
    .service-details dl div { display: flex; justify-content: space-between; gap: 18px; padding: 8px 0; border-bottom: 1px solid var(--border); }
    .service-details dt { color: var(--muted); font-size: 0.82rem; font-weight: 800; }
    .service-details dd { margin: 0; font-size: 0.84rem; font-weight: 900; text-align: right; }
    .booking-cta .bottom-action-card ion-button[disabled] { opacity: 1; --background: rgba(148, 163, 184, 0.35); --color: rgba(71, 85, 105, 0.75); box-shadow: none; }
    .drawer-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(15, 23, 42, 0.42); }
    .selections-drawer { position: fixed; left: 50%; z-index: 45; bottom: calc(var(--booking-footer-height) + 16px + env(safe-area-inset-bottom)); width: min(560px, calc(100% - 20px)); max-height: 55vh; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; border: 1px solid var(--border); border-radius: 22px; background: var(--surface); box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28); transform: translateX(-50%); }
    .drawer-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px; border-bottom: 1px solid var(--border); }
    .drawer-header h2 { margin: 0; font-size: 1rem; letter-spacing: -0.03em; }
    .drawer-done { min-height: 44px; padding: 0 14px; border: 0; border-radius: 999px; color: #FFFFFF; background: var(--primary); font-size: 0.84rem; font-weight: 950; }
    .drawer-list { display: grid; align-content: start; gap: 2px; overflow-y: auto; margin: 0; padding: 8px; list-style: none; }
    .drawer-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 8px; border-radius: 14px; }
    .drawer-item-copy { min-width: 0; display: grid; gap: 3px; }
    .drawer-item-copy strong, .drawer-item-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .drawer-item-copy strong { font-size: 0.9rem; }
    .drawer-item-copy small { color: var(--muted); font-size: 0.78rem; font-weight: 800; }
    .drawer-remove { min-height: 40px; padding: 0 12px; border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 999px; color: #EF4444; background: var(--surface); font-size: 0.78rem; font-weight: 950; }
    .drawer-empty { padding: 18px; color: var(--muted); text-align: center; }
    .assign-mode-card { display: grid; gap: 10px; padding: 14px; }
    .assign-mode-toggle { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 4px; border-radius: 14px; background: var(--surface-soft); }
    .assign-mode-toggle button { min-height: 42px; border: 0; border-radius: 11px; color: var(--muted); background: transparent; font-size: 0.86rem; font-weight: 950; }
    .assign-mode-toggle button.active { color: #FFFFFF; background: var(--primary); box-shadow: 0 6px 14px rgba(99, 102, 241, 0.25); }
    .assign-mode-toggle button:hover, .assign-mode-toggle button:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.4); outline-offset: 2px; }
    .assign-mode-help { margin: 0; color: var(--muted); font-size: 0.8rem; line-height: 1.4; }
    .best-available-card { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px; border-color: rgba(99, 102, 241, 0.35); background: var(--primary-soft); color: var(--text); text-align: left; }
    .best-available-card.selected { border-color: transparent; background: var(--primary); box-shadow: 0 14px 30px rgba(99, 102, 241, 0.28); }
    .best-available-copy { min-width: 0; display: grid; gap: 3px; }
    .best-available-copy strong { font-size: 0.95rem; }
    .best-available-copy small { color: var(--muted); font-size: 0.78rem; line-height: 1.35; }
    .best-available-card.selected .best-available-copy strong { color: #FFFFFF; }
    .best-available-card.selected .best-available-copy small { color: rgba(255, 255, 255, 0.82); }
    .best-available-state { min-height: 36px; display: inline-flex; align-items: center; gap: 6px; padding: 0 12px; border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.78rem; font-weight: 950; white-space: nowrap; }
    .best-available-card.selected .best-available-state { color: var(--primary); }
    .recommend-tag { display: inline-block; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); background: var(--surface-soft); font-size: 0.62rem; font-weight: 950; letter-spacing: 0.05em; text-transform: uppercase; vertical-align: 2px; }
    .service-assign-list { display: grid; gap: 10px; }
    .service-assign-card { display: grid; gap: 0; padding: 0; overflow: hidden; }
    .service-assign-head { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 14px; border: 0; color: var(--text); background: transparent; font: inherit; text-align: left; }
    .service-assign-head:hover, .service-assign-head:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.4); outline-offset: -2px; }
    .service-assign-index { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.82rem; font-weight: 950; }
    .service-assign-copy { min-width: 0; display: grid; gap: 2px; }
    .service-assign-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95rem; }
    .service-assign-copy small { overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; font-size: 0.76rem; font-weight: 800; }
    .service-assign-state { display: flex; align-items: center; gap: 8px; }
    .service-assign-state > ion-icon { color: var(--muted); transition: transform 180ms ease; }
    .service-assign-card.open .service-assign-state > ion-icon { transform: rotate(180deg); }
    .assign-badge { min-height: 24px; display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 0.68rem; font-weight: 950; white-space: nowrap; }
    .assign-badge.auto { color: var(--primary); background: var(--primary-soft); }
    .assign-badge.manual { color: #059669; background: #D1FAE5; }
    .assign-badge.pending { color: #B45309; background: #FEF3C7; }
    .service-assign-body { display: grid; gap: 10px; padding: 2px 14px 14px; }
    .per-service-auto { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 12px 14px; color: var(--text); text-align: left; }
    .per-service-auto > span:nth-child(2) { min-width: 0; display: grid; gap: 2px; }
    .per-service-auto strong { font-size: 0.9rem; }
    .per-service-auto small { color: var(--muted); font-size: 0.76rem; line-height: 1.3; }
    .per-service-auto em { min-width: 68px; min-height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0 12px; border-radius: 999px; color: var(--primary); background: var(--surface); font-size: 0.78rem; font-weight: 900; font-style: normal; }
    .per-service-auto.selected { border-color: transparent; background: var(--primary); }
    .per-service-auto.selected em { color: var(--primary); background: #FFFFFF; }
    .per-service-auto.selected strong { color: #FFFFFF; }
    .per-service-auto.selected small { color: rgba(255, 255, 255, 0.82); }
    .staff-avatar { width: 54px; height: 54px; display: grid; place-items: center; flex: 0 0 auto; overflow: hidden; border-radius: 18px; }
    .staff-avatar img { width: 100%; height: 100%; object-fit: cover; }
    .staff-initials { color: #FFFFFF; font-size: 1.05rem; font-weight: 950; letter-spacing: 0.02em; }
    .staff-copy { min-width: 0; display: grid; gap: 2px; color: var(--text); }
    .staff-copy small { display: block; color: var(--muted); line-height: 1.3; }
    .staff-role { font-size: 0.78rem; font-weight: 800; }
    .staff-tag { width: fit-content; padding: 2px 8px; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.68rem; font-weight: 900; }
    .staff-meta { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 0.74rem; font-weight: 800; }
    .staff-meta span { display: inline-flex; align-items: center; gap: 4px; }
    .staff-meta ion-icon { font-size: 0.85rem; }
    .staff-extras { display: grid; gap: 6px; justify-items: end; }
    .surcharge-chip { padding: 3px 8px; border-radius: 999px; color: #B45309; background: #FEF3C7; font-size: 0.7rem; font-weight: 950; white-space: nowrap; }
    .staff-choice.selected { border-color: transparent; background: var(--primary); box-shadow: 0 12px 24px rgba(99, 102, 241, 0.22); }
    .staff-choice.selected strong { color: #FFFFFF; }
    .staff-choice.selected .staff-copy { color: #FFFFFF; }
    .staff-choice.selected .staff-copy small { color: rgba(255, 255, 255, 0.82); }
    .staff-choice.selected .staff-tag { color: var(--primary); background: #FFFFFF; }
    .staff-choice.selected .surcharge-chip { color: #FFFFFF; background: rgba(255, 255, 255, 0.18); }
    .staff-choice.selected em { color: var(--primary); background: #FFFFFF; }
    .gender-filter { display: flex; gap: 8px; overflow-x: auto; padding: 2px 1px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .gender-filter::-webkit-scrollbar { display: none; }
    .gender-chip { flex: 0 0 auto; min-height: 36px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--surface); font-size: 0.8rem; font-weight: 900; }
    .gender-chip.active { color: #FFFFFF; border-color: transparent; background: var(--primary); }
    .gender-chip:hover, .gender-chip:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.4); outline-offset: 2px; }
    .gender-note { margin: -4px 0 0; color: var(--muted); font-size: 0.72rem; line-height: 1.35; }
    .slot-reset-warning { display: grid; gap: 10px; padding: 12px; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 14px; background: #FFFBEB; }
    .slot-reset-warning p { margin: 0; color: #92400E; font-size: 0.8rem; font-weight: 850; line-height: 1.4; }
    .slot-reset-warning > div { display: flex; gap: 8px; justify-content: flex-end; }
    .warning-ghost { min-height: 40px; padding: 0 14px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--surface); font-size: 0.8rem; font-weight: 950; }
    .warning-confirm { min-height: 40px; padding: 0 14px; border: 0; border-radius: 999px; color: #FFFFFF; background: var(--primary); font-size: 0.8rem; font-weight: 950; }
    /* Date & Time Selection — Enhanced 7-day grid, month selector, visit timeline */
    .date-time-panel { display: grid; gap: 14px; }
    .visit-summary-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-color: rgba(99, 102, 241, 0.3); background: var(--primary-soft); }
    .visit-summary-info { display: flex; align-items: center; gap: 10px; }
    .visit-summary-info ion-icon { color: var(--primary); font-size: 1.3rem; }
    .visit-summary-info strong { display: block; color: var(--text); font-size: 0.95rem; font-weight: 950; }
    .visit-summary-info small { color: var(--muted); font-size: 0.76rem; font-weight: 800; }
    .mode-toggle-label { display: inline-flex; align-items: center; gap: 8px; font-size: 0.78rem; font-weight: 850; color: var(--text); cursor: pointer; user-select: none; }
    .mode-toggle-label input { width: 16px; height: 16px; accent-color: var(--primary); }
    
    .calendar-container { display: grid; gap: 10px; padding: 14px; }
    .month-selector-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .month-title { color: var(--text); font-size: 0.95rem; font-weight: 950; letter-spacing: -0.02em; }
    .month-nav-btn { width: 44px; height: 44px; display: grid; place-items: center; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--surface); font-size: 1rem; cursor: pointer; }
    .month-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    
    .date-row.seven-days-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; overflow: visible; }
    .date-card { position: relative; display: grid; gap: 2px; justify-items: center; align-content: center; min-height: 74px; padding: 8px 4px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--text); font-weight: 900; text-align: center; cursor: pointer; }
    .date-card strong { font-size: 0.84rem; line-height: 1.1; }
    .date-card span { font-size: 0.72rem; color: var(--muted); line-height: 1.1; }
    .date-card .status-text { font-size: 0.62rem; color: var(--muted); font-weight: 800; white-space: nowrap; }
    .date-dot { width: 7px; height: 7px; border-radius: 999px; display: block; margin-bottom: 2px; }
    .date-dot.many { background: #10B981; }
    .date-dot.partial { background: #F59E0B; }
    .date-dot.full { background: #EF4444; }
    .date-card.selected { color: #FFFFFF; border-color: transparent; background: var(--primary); box-shadow: 0 8px 20px rgba(99, 102, 241, 0.28); }
    .date-card.selected span, .date-card.selected .status-text { color: rgba(255, 255, 255, 0.88); }
    .date-card.selected .date-dot { background: #FFFFFF; }
    
    .shortcuts-bar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
    .shortcut-chip { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.78rem; font-weight: 900; cursor: pointer; }
    .shortcut-chip.waitlist-chip { color: #B45309; border-color: rgba(245, 158, 11, 0.4); background: #FEF3C7; }
    .shortcut-chip ion-icon { font-size: 0.95rem; }
    
    .visit-timeline-card { display: grid; gap: 12px; padding: 14px; border-color: rgba(99, 102, 241, 0.35); background: var(--surface); }
    .timeline-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
    .timeline-badge { display: inline-block; padding: 2px 8px; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.66rem; font-weight: 950; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 4px; }
    .timeline-header strong { display: block; color: var(--text); font-size: 1.05rem; }
    .timeline-header small { color: var(--muted); font-size: 0.78rem; font-weight: 800; }
    .hold-timer-badge { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; color: #059669; background: #D1FAE5; font-size: 0.74rem; font-weight: 950; }
    .timeline-sequence { display: grid; gap: 8px; }
    .timeline-step { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 12px; align-items: center; padding: 8px 10px; border-radius: 12px; background: var(--surface-soft); }
    .step-time { font-size: 0.8rem; font-weight: 950; color: var(--primary); white-space: nowrap; }
    .step-details strong { display: block; font-size: 0.88rem; color: var(--text); }
    .step-details small { color: var(--muted); font-size: 0.76rem; font-weight: 800; }
    
    .section-subtitle-row { display: grid; gap: 2px; margin-top: 8px; }
    .section-subtitle-row h3 { margin: 0; font-size: 0.95rem; font-weight: 950; }
    .slot-group-header { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; cursor: pointer; text-align: left; }
    .slot-group-header h3 { margin: 0; font-size: 0.92rem; font-weight: 950; }
    .slot-group-header ion-icon { color: var(--muted); transition: transform 180ms ease; }
    .slot-group.collapsed .slot-group-header ion-icon { transform: rotate(-90deg); }

    .alternatives-card { display: grid; gap: 10px; padding: 14px; border-color: rgba(245, 158, 11, 0.4); background: #FFFBEB; }
    .alternatives-card h4 { margin: 0; color: #92400E; font-size: 0.92rem; font-weight: 950; }
    .alternatives-grid { display: grid; gap: 8px; }
    .alt-btn { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); text-align: left; cursor: pointer; text-decoration: none; }
    .alt-btn strong { font-size: 0.84rem; color: var(--primary); }
    .alt-btn small { font-size: 0.74rem; color: var(--muted); }
    .gap-toggle-label { display: inline-flex; align-items: center; gap: 8px; font-size: 0.78rem; font-weight: 850; color: #92400E; cursor: pointer; margin-top: 4px; }
    .slot-expired-card { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-color: rgba(239, 68, 68, 0.35); background: #FEF2F2; color: #991B1B; }
    .slot-expired-card ion-icon { font-size: 1.4rem; color: #EF4444; flex: 0 0 auto; }
    .slot-expired-card strong { display: block; font-size: 0.88rem; }
    .slot-expired-card p { margin: 0; font-size: 0.78rem; opacity: 0.9; }
    .scheduled-service-row { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
    .scheduled-service-row strong { font-size: 0.84rem; color: var(--text); }
    .scheduled-service-row small { font-size: 0.76rem; color: var(--muted); }
    .primary-gradient-btn { min-height: 44px; padding: 0 16px; border: 0; border-radius: 999px; color: #FFFFFF; background: var(--primary); font-size: 0.84rem; font-weight: 950; cursor: pointer; }
    /* Step 4 Review Screen Styling */
    .confirm-card-header h2 { margin: 0 0 14px; font-size: 1.25rem; font-weight: 950; letter-spacing: -0.03em; }
    .review-salon-strip { padding: 12px 14px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface-soft); margin-bottom: 12px; }
    .salon-info-row { display: flex; align-items: center; gap: 12px; }
    .salon-mark { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 14px; color: #FFFFFF; background: var(--primary); font-size: 1.1rem; font-weight: 950; flex: 0 0 auto; }
    .salon-copy { min-width: 0; display: grid; gap: 2px; }
    .salon-copy strong { font-size: 0.98rem; color: var(--text); }
    .salon-address { font-size: 0.8rem; color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
    .salon-address ion-icon { color: var(--primary); font-size: 0.95rem; }
    .tag-new { display: inline-block; padding: 2px 8px; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.68rem; font-weight: 950; }
    
    .review-section { display: grid; gap: 10px; padding: 14px 0; border-top: 1px solid var(--border); }
    .review-section-header { display: flex; align-items: center; justify-content: space-between; }
    .review-section-header h3 { margin: 0; font-size: 0.92rem; font-weight: 950; color: var(--text); }
    .btn-text-edit { padding: 4px 10px; border: 0; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.78rem; font-weight: 950; cursor: pointer; }
    .btn-text-edit:hover, .btn-text-edit:focus-visible { outline: 2px solid rgba(99, 102, 241, 0.4); }
    
    .review-services-list { display: grid; gap: 8px; }
    .review-service-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); }
    .service-seq-num { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 999px; color: #FFFFFF; background: var(--primary); font-size: 0.76rem; font-weight: 950; flex: 0 0 auto; }
    .review-service-details { min-width: 0; display: grid; gap: 2px; }
    .review-service-details .service-name { font-size: 0.92rem; color: var(--text); }
    .review-service-details .service-staff { font-size: 0.78rem; color: var(--primary); font-weight: 850; display: inline-flex; align-items: center; gap: 4px; }
    .review-service-details .service-meta { font-size: 0.76rem; color: var(--muted); font-weight: 800; }
    
    .review-staff-summary { display: flex; flex-wrap: wrap; gap: 8px; }
    .review-staff-chip { display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 12px; background: var(--surface-soft); font-size: 0.8rem; color: var(--text); }
    .review-staff-chip ion-icon { color: var(--primary); font-size: 0.9rem; }
    
    .validated-timeline-box { display: grid; gap: 8px; padding: 12px; border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 16px; background: var(--primary-soft); }
    .visit-date-badge { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 0.86rem; color: var(--text); }
    .visit-date-badge ion-icon { color: var(--primary); font-size: 1.05rem; }
    .validated-timeline-sequence { display: grid; gap: 6px; margin-top: 6px; }
    .validated-step { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; background: var(--surface); font-size: 0.8rem; }
    .step-num-badge { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 999px; color: var(--primary); background: var(--primary-soft); font-size: 0.68rem; font-weight: 950; }
    .step-time-window { font-weight: 950; color: var(--primary); white-space: nowrap; }
    .step-name { font-weight: 850; color: var(--text); }
    .step-staff { color: var(--muted); font-weight: 800; }
    
    .customer-note-input { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); color: var(--text); font: inherit; font-size: 0.85rem; resize: vertical; box-sizing: border-box; }
    
    .benefits-container { display: grid; gap: 10px; }
    .benefits-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-soft); font-size: 0.82rem; font-weight: 850; color: var(--text); }
    .benefits-row ion-icon { color: var(--primary); font-size: 1.1rem; }
    .btn-text-secondary { padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--text); background: var(--surface); font-size: 0.76rem; font-weight: 950; cursor: pointer; }
    .coupon-row { display: flex; gap: 8px; }
    .coupon-input { flex: 1; min-width: 0; padding: 0 12px; min-height: 40px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: var(--text); font: inherit; font-size: 0.84rem; text-transform: uppercase; }
    .btn-apply-coupon { min-height: 40px; padding: 0 14px; border: 0; border-radius: 12px; color: #FFFFFF; background: var(--primary); font-size: 0.8rem; font-weight: 950; cursor: pointer; }
    .coupon-msg.success { margin: 0; color: #059669; font-size: 0.78rem; font-weight: 900; }
    
    .policy-section { display: grid; gap: 8px; }
    .policy-item { display: flex; align-items: flex-start; gap: 10px; font-size: 0.78rem; color: var(--muted); }
    .policy-item ion-icon { color: var(--primary); font-size: 1.1rem; flex: 0 0 auto; margin-top: 2px; }
    .policy-item strong { display: block; color: var(--text); font-size: 0.82rem; }
    .policy-item p { margin: 2px 0 0; line-height: 1.35; }
    .policy-link-btn { padding: 0; border: 0; background: transparent; color: var(--primary); font: inherit; font-weight: 950; text-decoration: underline; cursor: pointer; }
    
    .price-summary-section { border-top: 2px dashed var(--border); }
    .price-summary-box { display: grid; gap: 8px; padding: 14px; border: 1px solid var(--border); border-radius: 16px; background: var(--surface); }
    .price-row { display: flex; justify-content: space-between; align-items: center; font-size: 0.84rem; color: var(--muted); }
    .price-row strong { color: var(--text); font-weight: 950; }
    .price-row.discount-row strong { color: #059669; }
    .price-row.final-total-row { padding-top: 8px; margin-top: 4px; border-top: 1px solid var(--border); }
    .price-row.final-total-row strong { font-size: 1rem; color: var(--primary); }
    .price-row.final-total-row small { display: block; font-size: 0.72rem; color: var(--muted); font-weight: 800; }
    .final-pay-note { color: var(--primary); font-size: 0.78rem; font-weight: 950; }
    .pay-amount-highlight { color: var(--primary); font-weight: 950; font-size: 0.88rem; }
    
    .policy-modal { max-height: 70vh; }
    .policy-modal-body { padding: 16px; display: grid; gap: 12px; overflow-y: auto; }
    .policy-modal-body h4 { margin: 0; color: var(--text); font-size: 0.95rem; font-weight: 950; }
    .policy-modal-body p { margin: 0; color: var(--muted); font-size: 0.84rem; line-height: 1.45; }

    @media (max-width: 599px) {
      .staff-avatar { width: 44px; height: 44px; border-radius: 14px; }
      .staff-initials { font-size: 0.95rem; }
      .service-assign-head { gap: 9px; padding: 12px; }
      .service-assign-body { padding: 2px 12px 12px; }
      .best-available-card { gap: 10px; padding: 12px; }
      .best-available-state { padding: 0 10px; font-size: 0.72rem; }
      .date-row.seven-days-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; overflow-x: auto; }
      .timeline-step { grid-template-columns: 1fr; gap: 4px; }
    }
    @media (max-width: 430px) {
      .service-assign-index { width: 26px; height: 26px; font-size: 0.76rem; }
      .service-assign-copy strong { font-size: 0.9rem; }
      .assign-mode-toggle button { font-size: 0.82rem; }
    }
    @media (prefers-reduced-motion: reduce) {
      .skeleton-line, .slot.skeleton-slot, .group-header ion-icon, .service-assign-state > ion-icon { animation: none; transition: none; }
    }
    @keyframes booking-skeleton { from { background-position: 120% 0; } to { background-position: -120% 0; } }
    @keyframes button-spin { to { transform: rotate(360deg); } }
  `]
})
export class BookingFlowPage implements OnInit, OnDestroy {
  readonly customerNote = signal("");
  readonly couponCode = signal("");
  readonly couponSuccessMsg = signal("");
  readonly benefitsApplied = signal(false);
  readonly discountPaise = signal(0);
  readonly showPolicyModal = signal(false);

  readonly continuousVisitMode = signal(true);
  readonly allowShortGap = signal(false);
  readonly dateOffset = signal(0);
  readonly collapsedSlotGroups = signal<Record<string, boolean>>({});
  readonly slotHoldSeconds = signal<number | null>(null);
  readonly slotExpiredWarning = signal<string>("");
  private holdTimerInterval: any = null;

  readonly visibleAvailabilityDays = computed(() => {
    const all = this.availabilityDays();
    const start = this.dateOffset();
    if (!all.length) return [];
    return all.slice(start, start + 7);
  });

  readonly continuousTimelineItems = computed(() => {
    const items = this.bookingItems();
    if (!items.length) return [];
    const firstSlot = items[0]?.slotStartAt;
    if (!firstSlot) return [];
    let currentMs = new Date(firstSlot).getTime();
    if (!Number.isFinite(currentMs)) return [];
    const bufferMs = (this.allowShortGap() ? 15 : 5) * 60000;

    return items.map((item, idx) => {
      const service = this.serviceById(item.serviceId);
      const durationMs = (service?.durationMinutes || 20) * 60000;
      const startMs = currentMs;
      const endMs = startMs + durationMs;
      currentMs = endMs + bufferMs;

      const startDate = new Date(startMs);
      const endDate = new Date(endMs);

      return {
        index: idx,
        serviceId: item.serviceId,
        serviceName: service ? this.formatServiceName(service.name) : `Service ${idx + 1}`,
        staffName: this.itemStaffName(item),
        durationMinutes: service?.durationMinutes || 0,
        startIso: startDate.toISOString(),
        endIso: endDate.toISOString(),
        startTimeLabel: startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        endTimeLabel: endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      };
    });
  });

  readonly continuousVisitTimeRangeLabel = computed(() => {
    const items = this.continuousTimelineItems();
    if (!items.length) return "";
    return `${items[0].startTimeLabel}–${items[items.length - 1].endTimeLabel}`;
  });

  /** Review timeline: each service's OWN selected start time, sorted chronologically — correct for both continuous and separate booking modes. */
  readonly reviewTimelineItems = computed(() => {
    const rows: Array<{
      serviceId: string;
      serviceName: string;
      staffName: string;
      durationMinutes: number;
      startIso: string;
      endIso: string;
      startTimeLabel: string;
      endTimeLabel: string;
    }> = [];
    for (const item of this.bookingItems()) {
      if (!item.slotStartAt) continue;
      const start = new Date(item.slotStartAt);
      if (!Number.isFinite(start.getTime())) continue;
      const service = this.serviceById(item.serviceId);
      const end = new Date(start.getTime() + ((service?.durationMinutes || 20) * 60000));
      rows.push({
        serviceId: item.serviceId,
        serviceName: service ? this.formatServiceName(service.name) : "Service",
        staffName: this.itemStaffName(item),
        durationMinutes: service?.durationMinutes || 0,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        startTimeLabel: start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        endTimeLabel: end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
      });
    }
    return rows.sort((a, b) => (a.startIso < b.startIso ? -1 : 1));
  });

  readonly reviewVisitTimeRangeLabel = computed(() => {
    const items = this.reviewTimelineItems();
    if (!items.length) return "";
    return `${items[0].startTimeLabel}–${items[items.length - 1].endTimeLabel}`;
  });

  reviewWindowDurationLabel(): string {
    const items = this.reviewTimelineItems();
    if (items.length < 2) return this.durationLabel();
    const start = new Date(items[0].startIso).getTime();
    const end = new Date(items[items.length - 1].endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return this.durationLabel();
    return `${Math.round((end - start) / 60000)} min`;
  }

  visitWindowDurationLabel(): string {
    const items = this.continuousTimelineItems();
    if (items.length < 2) return this.durationLabel();
    const start = new Date(items[0].startIso).getTime();
    const end = new Date(items[items.length - 1].endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return this.durationLabel();
    const minutes = Math.round((end - start) / 60000);
    return `${minutes} min`;
  }

  readonly step = signal(Number(this.route.snapshot.queryParamMap.get("step") || (this.initialServiceIds().length ? 2 : 1)));
  readonly bookingItems = signal<BookingFlowItem[]>(this.initialServiceIds().map((serviceId) => ({
    serviceId,
    staffId: this.route.snapshot.queryParamMap.get("staffId") || null,
    date: this.route.snapshot.queryParamMap.get("date") ?? "",
    slotStartAt: this.route.snapshot.queryParamMap.get("slotStartAt") ?? ""
  })));
  readonly activeItemIndex = signal(0);
  readonly rescheduleBookingId = this.route.snapshot.queryParamMap.get("rescheduleBookingId") ?? "";
  readonly flowWarning = signal("");
  readonly serviceQuery = signal("");
  readonly activeCategory = signal("Popular");
  readonly collapsedGroups = signal<Record<string, boolean>>({});
  readonly expandedServiceId = signal("");
  readonly selectionsOpen = signal(false);
  readonly assignmentMode = signal<"auto" | "manual">("auto");
  readonly activeGenderFilter = signal("");
  readonly pendingStaffChange = signal<{ index: number; staffId: string | null } | null>(null);
  private readonly slug = signal(this.route.snapshot.paramMap.get("slug"));
  readonly business = computed(() => this.marketplace.findBusiness(this.slug()));
  readonly selectedServices = computed(() => this.bookingItems().map((item) => this.serviceById(item.serviceId)).filter((service): service is ServiceItem => !!service));
  readonly selectedService = computed(() => this.activeService() ?? this.selectedServices()[0] ?? null);
  readonly activeItem = computed(() => this.bookingItems()[this.activeItemIndex()] ?? null);
  readonly activeService = computed(() => this.activeItem() ? this.serviceById(this.activeItem()!.serviceId) : null);
  readonly activeStaff = computed(() => this.activeItem()?.staffId ? this.business()?.staff.find((staff) => staff.id === this.activeItem()?.staffId) ?? null : null);
  readonly availabilityDays = computed(() => this.marketplace.availability());
  readonly selectedAvailabilityDay = computed(() => this.availabilityDays().find((day) => day.date === (this.activeItem()?.date || "")) ?? this.availabilityDays()[0] ?? null);
  readonly slotGroups = computed(() => this.selectedAvailabilityDay()?.periods ?? []);
  readonly currentBookingStep = computed(() => this.normalizedStep(this.step()));
  readonly scheduledServiceSummaries = computed(() => this.bookingItems()
    .map((item, index) => ({
      index,
      active: index === this.activeItemIndex(),
      name: this.serviceById(item.serviceId)?.name || `Service ${index + 1}`,
      staff: this.itemStaffName(item),
      time: this.itemSlotLabel(index),
      scheduled: !!item.slotStartAt
    }))
    .filter((item) => item.scheduled));

  isRescheduling(): boolean {
    return !!this.rescheduleBookingId;
  }

  readonly hasBookableServices = computed(() => (this.business()?.services?.length ?? 0) > 0);

  readonly otherBranches = computed(() => {
    const current = this.business();
    if (!current?.tenantId) return [];
    const seen = new Set<string>();
    return this.marketplace.businesses().filter((branch) => {
      if (branch.tenantId !== current.tenantId) return false;
      if (branch.id === current.id || branch.slug === current.slug || (current.branchId && branch.branchId === current.branchId)) return false;
      const key = branch.branchId || branch.id || branch.slug;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

  readonly filteredServices = computed(() => {
    const query = this.serviceQuery().trim().toLowerCase();
    if (!query) return this.business()?.services ?? [];
    return (this.business()?.services ?? []).filter((service) =>
      service.name.toLowerCase().includes(query)
      || (service.description || "").toLowerCase().includes(query)
      || (service.category || "").toLowerCase().includes(query));
  });

  readonly serviceChips = computed(() => {
    const categories = Array.from(new Set((this.business()?.services ?? []).map((service) => this.formatServiceName(service.category || "Other")).filter(Boolean)));
    return ["Popular", ...categories];
  });

  readonly groupedServices = computed(() => {
    const services = this.filteredServices();
    const active = this.activeCategory();
    const groups: { label: string; services: ServiceItem[] }[] = [];
    if (active === "Popular") {
      const popular = services.filter((service) => service.popular);
      if (popular.length) groups.push({ label: "Popular at this salon", services: popular });
      const byCategory = new Map<string, ServiceItem[]>();
      for (const service of services.filter((service) => !service.popular)) {
        const key = this.formatServiceName(service.category || "Other");
        if (!byCategory.has(key)) byCategory.set(key, []);
        byCategory.get(key)!.push(service);
      }
      for (const [label, items] of byCategory) groups.push({ label, services: items });
      return groups;
    }
    const matching = services.filter((service) => this.formatServiceName(service.category || "Other") === active);
    if (matching.length) groups.push({ label: active, services: matching });
    return groups;
  });

  headerSubtitle(): string {
    const business = this.business();
    if (!business) return "Select your service";
    return business.area ? `${business.businessName} · ${business.area}` : business.businessName;
  }

  heroRatingLabel(): string {
    const business = this.business();
    if (!business) return "";
    const rating = Number(business.ratingAverage);
    const hasReviews = Number(business.ratingCount || 0) >= 5;
    if (!Number.isFinite(rating) || rating <= 0 || !hasReviews) return "New salon";
    return `${rating.toFixed(1)} rating`;
  }

  contactPhone(): string {
    const business = this.business();
    return String(business?.phone || business?.mobileNumber || business?.appointmentNumber || "").trim();
  }

  branchBookLink(branch: { slug: string }): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("business", branch.slug, "book") : `/business/${encodeURIComponent(branch.slug)}/book`;
  }

  exploreHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/home";
  }

  goBack(): void {
    void this.router.navigateByUrl(this.exploreHref());
  }

  formatServiceName(name: string): string {
    const trimmed = String(name || "").trim();
    if (!trimmed) return "";
    return trimmed.split(/\s+/).map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
  }

  serviceDescription(service: ServiceItem): string {
    const description = String(service.description || "").trim();
    if (description) return description;
    return `${this.formatServiceName(service.category || "Salon")} service · ${service.durationMinutes || 0} min visit`;
  }

  eligibleStaffLabel(service: ServiceItem): string {
    const count = this.staffForService(service).length;
    return count > 0 ? `${count} professional${count === 1 ? "" : "s"} available` : "Any available professional";
  }

  onServiceSearch(event: Event) {
    this.serviceQuery.set(String((event.target as HTMLInputElement).value));
  }

  setActiveCategory(chip: string) {
    this.activeCategory.set(chip);
    this.expandedServiceId.set("");
  }

  toggleGroup(label: string) {
    this.collapsedGroups.update((state) => ({ ...state, [label]: !state[label] }));
  }

  groupCollapsed(label: string): boolean {
    return !!this.collapsedGroups()[label];
  }

  toggleServiceDetails(serviceId: string) {
    this.expandedServiceId.update((current) => (current === serviceId ? "" : serviceId));
  }

  constructor(private readonly route: ActivatedRoute, private readonly router: Router, readonly marketplace: MarketplaceService) {
    addIcons({ alertCircleOutline, arrowBackOutline, calendarOutline, callOutline, chatbubbleOutline, checkmarkCircleOutline, checkmarkOutline, chevronBackOutline, chevronDownOutline, chevronForwardOutline, flashOutline, locationOutline, personOutline, searchOutline, sparklesOutline, storefrontOutline, timeOutline });
  }

  ngOnInit() {
    this.reload();
  }

  ngOnDestroy() {
    if (this.holdTimerInterval) {
      clearInterval(this.holdTimerInterval);
      this.holdTimerInterval = null;
    }
  }

  async reload() {
    const slug = await this.resolveBusinessSlug();
    if (!slug) return;
    this.slug.set(slug);
    await this.marketplace.loadBusiness(slug).catch(async () => {
      const fallbackSlug = await this.mySalonBusinessSlug();
      if (!fallbackSlug || fallbackSlug === slug) return;
      this.slug.set(fallbackSlug);
      await this.marketplace.loadBusiness(fallbackSlug).catch(() => undefined);
    });
    if (!this.isRescheduling()) this.restorePendingIntent();
    if (!this.route.snapshot.queryParamMap.has("step")) {
      this.step.set(this.bookingItems().length ? 2 : 1);
    } else if (this.step() < 1 || this.step() > 4) {
      this.step.set(1);
    }
    await this.reloadAvailability();
  }

  private async resolveBusinessSlug(): Promise<string> {
    return this.slug() || await this.mySalonBusinessSlug();
  }

  private async mySalonBusinessSlug(): Promise<string> {
    if (!this.marketplace.salonMode()) return "";
    const existing = this.marketplace.mySalonDashboard()?.salon?.slug || "";
    if (existing) return existing;
    const dashboard = await this.marketplace.loadMySalonDashboard().catch(() => null);
    return dashboard?.salon?.slug || "";
  }

  next() {
    this.flowWarning.set("");
    this.selectionsOpen.set(false);
    this.pendingStaffChange.set(null);
    const nextStep = Math.min(this.currentBookingStep() + 1, 4) as BookingProgressStepId;
    this.step.set(nextStep);
    if (nextStep === 3) void this.reloadAvailability();
  }

  goToStep(stepId: BookingProgressStepId) {
    if (stepId > this.currentBookingStep()) return;
    this.flowWarning.set("");
    this.selectionsOpen.set(false);
    this.pendingStaffChange.set(null);
    this.step.set(stepId);
    if (stepId === 3) void this.reloadAvailability();
  }

  toggleService(serviceId: string) {
    const removing = this.bookingItems().some((item) => item.serviceId === serviceId);
    this.bookingItems.update((items) => {
      if (removing) return items.filter((item) => item.serviceId !== serviceId);
      return [...items, { serviceId, staffId: null, date: "", slotStartAt: "" }];
    });
    if (this.activeItemIndex() >= this.bookingItems().length) this.activeItemIndex.set(Math.max(this.bookingItems().length - 1, 0));
    if (removing) this.reconcileInvalidSelections();
    void this.reloadAvailability();
  }

  private reconcileInvalidSelections(): void {
    const business = this.business();
    if (!business) return;
    let changed = false;
    this.bookingItems.update((items) => items.map((item) => {
      if (!item.staffId) return item;
      const stillBookable = business.staff.some((staff) =>
        staff.id === item.staffId && (!staff.bookableServiceIds?.length || staff.bookableServiceIds.includes(item.serviceId)));
      if (stillBookable) return item;
      changed = true;
      return { ...item, staffId: null, slotStartAt: "" };
    }));
    if (changed) {
      this.flowWarning.set("A professional linked to your previous services is no longer available for the updated selection, so that time was cleared too. Please review Professionals and Time.");
    }
  }

  isServiceSelected(serviceId: string): boolean {
    return this.bookingItems().some((item) => item.serviceId === serviceId);
  }

  setItemStaff(index: number, staffId: string | null) {
    this.bookingItems.update((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, staffId, slotStartAt: "" } : item));
    if (this.bookingItems().length > 1) {
      const nextIndex = index + 1;
      if (nextIndex < this.bookingItems().length) {
        this.activeItemIndex.set(nextIndex);
      } else {
        this.activeItemIndex.set(index);
      }
    } else {
      this.activeItemIndex.set(index);
    }
    void this.reloadAvailability();
  }

  staffSelectedSummary(): string {
    const total = this.bookingItems().length;
    if (!total) return "";
    return `Service ${this.activeItemIndex() + 1} of ${total}`;
  }

  async checkItemSlots(event: Event, index: number, staffId: string) {
    event.preventDefault();
    event.stopPropagation();
    this.bookingItems.update((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, staffId, slotStartAt: "" } : item));
    this.activeItemIndex.set(index);
    this.step.set(3);
    await this.reloadAvailability();
  }

  setDate(date: string) {
    const currentIndex = this.activeItemIndex();
    this.bookingItems.update((items) => items.map((item, index) => index === currentIndex ? { ...item, date, slotStartAt: "" } : item));
    void this.reloadAvailability();
  }

  setActiveItem(index: number) {
    this.activeItemIndex.set(index);
    void this.reloadAvailability();
  }

  assignAnyStaffToAll() {
    this.bookingItems.update((items) => items.map((item) => ({ ...item, staffId: null, slotStartAt: "" })));
    void this.reloadAvailability();
  }

  allAutoAssigned(): boolean {
    const items = this.bookingItems();
    return items.length > 0 && items.every((item) => item.staffId === null);
  }

  assigneeLabel(item: BookingFlowItem): string {
    if (item.staffId) {
      const staff = this.business()?.staff.find((row) => row.id === item.staffId);
      return staff ? this.formatServiceName(staff.name) : "Selected professional";
    }
    return "Best available";
  }

  staffInitials(name: string): string {
    const words = String(name || "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("") || "?";
  }

  staffSurcharge(service: ServiceItem, staff: StaffMember): string | null {
    if (typeof staff.pricePaise !== "number") return null;
    const diff = staff.pricePaise - (service.pricePaise || 0);
    if (!diff) return null;
    return (diff > 0 ? "+" : "−") + this.money(Math.abs(diff));
  }

  staffGenders(service: ServiceItem): string[] {
    return Array.from(new Set(this.staffForService(service).map((staff) => (staff.gender || "").trim()).filter(Boolean)));
  }

  filteredStaffForService(service: ServiceItem): StaffMember[] {
    const preferred = this.activeGenderFilter();
    if (!preferred) return this.staffForService(service);
    return this.staffForService(service).filter((staff) => (staff.gender || "").trim() === preferred);
  }

  setAssignmentMode(mode: "auto" | "manual") {
    this.assignmentMode.set(mode);
    this.activeGenderFilter.set("");
    this.pendingStaffChange.set(null);
  }

  pickStaff(index: number, staffId: string | null) {
    const item = this.bookingItems()[index];
    if (item?.slotStartAt && item.staffId !== staffId) {
      this.pendingStaffChange.set({ index, staffId });
      return;
    }
    this.setItemStaff(index, staffId);
  }

  confirmStaffChange() {
    const pending = this.pendingStaffChange();
    this.pendingStaffChange.set(null);
    if (!pending) return;
    this.setItemStaff(pending.index, pending.staffId);
  }

  cancelStaffChange() {
    this.pendingStaffChange.set(null);
  }

  assignStatusLabel(): string {
    const total = this.bookingItems().length;
    if (!total) return "";
    if (this.assignmentMode() === "auto" || this.bookingItems().every((item) => item.staffId === null)) {
      return `Best available for all ${total} ${total === 1 ? "service" : "services"}`;
    }
    const assigned = this.bookingItems().filter((item) => item.staffId).length;
    return `${assigned} of ${total} services assigned`;
  }

  slotsSelectedSummary(): string {
    const selected = this.bookingItems().filter((item) => !!item.slotStartAt).length;
    const total = this.bookingItems().length;
    return `${selected} of ${total} slots chosen`;
  }

  dateAvailabilityClass(day: AvailabilityDay): "full" | "many" | "partial" {
    const slots = day.periods.flatMap((period) => period.slots);
    if (!slots.length) return "full";
    const available = slots.filter((slot) => slot.available).length;
    if (available === 0) return "full";
    if (available / slots.length >= 0.6) return "many";
    return "partial";
  }

  dateAvailabilityLabel(day: AvailabilityDay): string {
    const slots = day.periods.flatMap((period) => period.slots);
    const available = slots.filter((slot) => slot.available).length;
    if (!slots.length || available === 0) return "Booked";
    if (available / slots.length >= 0.6) return "Available";
    return "Filling fast";
  }

  dateCardLabel(day: AvailabilityDay): string {
    const selected = this.activeItem()?.date === day.date ? "Selected, " : "";
    return `${selected}${day.dayLabel}, ${day.label}, ${this.dateAvailabilityLabel(day)}`;
  }

  canContinue(): boolean {
    if (this.currentBookingStep() === 1) return this.bookingItems().length > 0;
    if (this.currentBookingStep() === 2) return this.bookingItems().length > 0;
    if (this.currentBookingStep() === 3) return this.bookingItems().length > 0 && this.bookingItems().every((item) => !!item.slotStartAt);
    return true;
  }

  canConfirm(): boolean {
    return !!this.business() && this.bookingItems().length > 0 && this.bookingItems().every((item) => !!this.serviceById(item.serviceId) && !!item.slotStartAt);
  }

  private normalizedStep(step: number): BookingProgressStepId {
    const clamped = Math.min(Math.max(Math.trunc(step) || 1, 1), 4) as BookingProgressStepId;
    if (!this.bookingItems().length) return 1;
    if (clamped === 4 && !this.canConfirm()) return 3;
    return clamped;
  }

  money(pricePaise: number): string {
    return this.marketplace.formatMoney(pricePaise);
  }

  bookingTotalLabel(): string {
    const total = this.selectedServices().reduce((sum, service) => sum + service.pricePaise, 0);
    const minutes = this.selectedServices().reduce((sum, service) => sum + service.durationMinutes, 0);
    if (!total) return "";
    return minutes > 0 ? `${this.money(total)} · Total ${minutes} min` : this.money(total);
  }

  serviceCountLabel(): string {
    const count = this.selectedServices().length;
    return `${count} service${count === 1 ? "" : "s"}`;
  }

  durationLabel(): string {
    const minutes = this.selectedServices().reduce((sum, service) => sum + service.durationMinutes, 0);
    return minutes ? `${minutes} min` : "0 min";
  }

  totalPriceLabel(): string {
    const total = this.selectedServices().reduce((sum, service) => sum + service.pricePaise, 0);
    return total ? this.money(total) : this.money(0);
  }

  servicePriceLabel(service: ServiceItem): string {
    return service.durationMinutes > 0 ? `${this.money(service.pricePaise)} · ${service.durationMinutes} min` : this.money(service.pricePaise);
  }

  activeServiceLabel(service: ServiceItem): string {
    return service.durationMinutes > 0 ? `${service.name} · ${service.durationMinutes} min` : service.name;
  }

  onCustomerNoteInput(event: Event) {
    this.customerNote.set((event.target as HTMLTextAreaElement).value);
  }

  onCouponInput(event: Event) {
    this.couponCode.set((event.target as HTMLInputElement).value);
  }

  applyCoupon() {
    const code = this.couponCode().trim().toUpperCase();
    if (!code) return;
    if (code === "AURA10" || code === "WELCOME" || code === "SAVE50") {
      this.discountPaise.set(5000);
      this.couponSuccessMsg.set(`Offer '${code}' applied! You saved ₹50.`);
    } else {
      this.discountPaise.set(2000);
      this.couponSuccessMsg.set(`Promo code '${code}' applied! You saved ₹20.`);
    }
  }

  toggleApplyBenefits() {
    const current = this.benefitsApplied();
    this.benefitsApplied.set(!current);
    if (!current) {
      this.discountPaise.update((d) => d + 3000);
    } else {
      this.discountPaise.update((d) => Math.max(0, d - 3000));
    }
  }

  finalPayableAmount(): number {
    const subtotalPaise = this.selectedServices().reduce((sum, service) => sum + service.pricePaise, 0);
    const finalPaise = Math.max(0, subtotalPaise - this.discountPaise());
    return Math.round(finalPaise / 100);
  }

  finalPayableLabel(): string {
    const subtotalPaise = this.selectedServices().reduce((sum, service) => sum + service.pricePaise, 0);
    const finalPaise = Math.max(0, subtotalPaise - this.discountPaise());
    return `${this.money(finalPaise)} payable at salon`;
  }

  selectedServicesSummary(): string {
    const count = this.selectedServices().length;
    if (!count) return "";
    if (this.currentBookingStep() === 3 && count > 1) {
      const set = this.bookingItems().filter((item) => !!item.slotStartAt).length;
      if (set < count) return `${set} of ${count} slots chosen — Select time for next service`;
      return `All ${count} slots selected`;
    }
    return `${count} service${count === 1 ? "" : "s"} selected`;
  }

  serviceImage(service: ServiceItem, index: number): string {
    const withImage = service as ServiceItem & { image?: string; imageUrl?: string; photoUrl?: string; thumbnailUrl?: string };
    const business = this.business();
    return withImage.image || withImage.imageUrl || withImage.photoUrl || withImage.thumbnailUrl || business?.galleryImages?.[index % Math.max(business.galleryImages.length, 1)] || business?.coverImage || "assets/icons/icon.svg";
  }

  /** Builds the full multi-service context passed to the confirmation screen via router state. */
  private buildSuccessState() {
    const business = this.business();
    const items = this.bookingItems();
    const timeline = this.reviewTimelineItems();
    const lastBooking = this.marketplace.latestBooking();
    const subtotalPaise = this.selectedServices().reduce((sum, service) => sum + service.pricePaise, 0);
    const finalPaise = Math.max(0, subtotalPaise - this.discountPaise());
    const services = items.map((item) => {
      const service = this.serviceById(item.serviceId);
      const startIso = item.slotStartAt || "";
      let endIso = "";
      if (startIso) {
        const start = new Date(startIso);
        if (Number.isFinite(start.getTime())) {
          endIso = new Date(start.getTime() + ((service?.durationMinutes || 20) * 60000)).toISOString();
        }
      }
      return {
        name: service ? this.formatServiceName(service.name) : "Service",
        staff: this.itemStaffName(item),
        durationMinutes: service?.durationMinutes || 0,
        pricePaise: service?.pricePaise || 0,
        startIso,
        endIso
      };
    });
    const startIso = timeline[0]?.startIso || services.map((s) => s.startIso).filter(Boolean).sort()[0] || "";
    const endIso = timeline[timeline.length - 1]?.endIso || services.map((s) => s.endIso).filter(Boolean).sort().reverse()[0] || "";
    return {
      services,
      businessName: business?.businessName || "",
      area: business?.area || "",
      city: business?.city || "",
      address: business?.address || "",
      reference: lastBooking?.reference || "",
      status: lastBooking?.status || "confirmed",
      startIso,
      endIso,
      dueLabel: this.money(finalPaise),
      paymentMode: "pay_at_venue"
    };
  }

  async confirmBooking() {
    const business = this.business();
    const items = this.bookingItems();
    if (!business || !items.length || !this.canConfirm()) return;
    if (!this.isRescheduling()) this.savePendingIntent();
    if (!this.marketplace.isAuthenticated()) {
      this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url } });
      return;
    }
    const customer = this.marketplace.customer();
    if (customer && !this.profileComplete(customer)) {
      this.router.navigate(["/login"], { queryParams: { returnUrl: this.router.url, complete: "profile" } });
      return;
    }
    const slotStillAvailable = await this.revalidateSelectedSlot();
    if (!slotStillAvailable) return;
    if (this.rescheduleBookingId) {
      const item = items[0];
      await this.marketplace.rescheduleBooking(this.rescheduleBookingId, {
        startAt: item.slotStartAt,
        staffId: item.staffId || undefined,
        serviceId: item.serviceId
      });
      await this.router.navigateByUrl(this.bookingDetailUrl(this.rescheduleBookingId), { replaceUrl: true });
      return;
    }
    let createdCount = 0;
    try {
      for (const item of items) {
        await this.marketplace.createBooking({
          businessSlug: business.slug,
          businessId: business.id,
          serviceId: item.serviceId,
          staffId: item.staffId || undefined,
          startAt: item.slotStartAt,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          paymentMode: "pay_at_venue"
        });
        createdCount += 1;
      }
    } catch {
      const remaining = items.length - createdCount;
      this.marketplace.error.set(createdCount > 0
        ? `${createdCount} service${createdCount === 1 ? "" : "s"} were booked, but ${remaining} could not be completed. Please check My bookings before trying again.`
        : this.marketplace.error() || "Could not complete booking. Please try again.");
      this.step.set(4);
      return;
    }
    this.clearPendingIntent();
    const successUrl = this.marketplace.salonMode() ? this.marketplace.salonModeUrl("booking", "success") : "/booking/success";
    this.router.navigateByUrl(successUrl, { state: this.buildSuccessState() });
  }

  backHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/home";
  }

  private bookingDetailUrl(id: string): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl("bookings", id) : `/bookings/${encodeURIComponent(id)}`;
  }

  private async revalidateSelectedSlot(): Promise<boolean> {
    for (let index = 0; index < this.bookingItems().length; index += 1) {
      this.activeItemIndex.set(index);
      const item = this.bookingItems()[index];
      await this.reloadAvailability();
      const available = this.marketplace.availability()
        .flatMap((day) => day.periods)
        .flatMap((period) => period.slots)
        .some((slot) => slot.startAt === item.slotStartAt && this.isSlotSelectable(slot));
      if (!available) {
        this.bookingItems.update((items) => items.map((row, rowIndex) => rowIndex === index ? { ...row, slotStartAt: "" } : row));
        this.step.set(3);
        this.marketplace.error.set("One selected slot was just taken or overlaps another service. Please choose another time.");
        return false;
      }
    }
    return true;
  }

  private async reloadAvailability() {
    const business = this.business();
    const item = this.activeItem();
    const service = this.activeService();
    if (!business || !service) return;
    const queryDate = item?.date || this.bookingItems().find((row) => row.date)?.date || new Date().toISOString().slice(0, 10);
    const days = await this.marketplace.loadAvailability(business.slug, {
      serviceId: service.id,
      staffId: item?.staffId || undefined,
      date: queryDate,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).catch(() => []);
    if (days[0]?.date) {
      const activeIdx = this.activeItemIndex();
      this.bookingItems.update((items) => items.map((row, rowIndex) => {
        if (!row.date || rowIndex === activeIdx) return { ...row, date: row.date || days[0].date };
        return row;
      }));
    }
  }

  serviceById(serviceId: string): ServiceItem | null {
    return this.business()?.services.find((service) => service.id === serviceId) ?? null;
  }

  staffForService(service: ServiceItem): StaffMember[] {
    return this.business()?.staff.filter((staff) => !staff.bookableServiceIds?.length || staff.bookableServiceIds.includes(service.id)) ?? [];
  }

  itemStaffName(item: BookingFlowItem): string {
    return item.staffId ? this.business()?.staff.find((staff) => staff.id === item.staffId)?.name ?? "Selected staff" : "Any professional";
  }

  staffActionLabel(item: BookingFlowItem, staff: StaffMember): string {
    if (item.staffId !== staff.id) return "Select";
    return item.slotStartAt ? "Change time" : "Choose time";
  }

  activeStaffName(): string {
    const item = this.activeItem();
    return item ? this.itemStaffName(item) : "Any available professional";
  }

  activeSlotStatusLabel(): string {
    const label = this.itemSlotLabel(this.activeItemIndex());
    return label ? `Selected time: ${label}` : "Choose a time";
  }

  itemSlotLabel(index: number): string {
    const item = this.bookingItems()[index];
    if (!item?.slotStartAt) return "";
    const slot = this.availabilityDays().flatMap((day) => day.periods).flatMap((period) => period.slots).find((row) => row.startAt === item.slotStartAt);
    return slot?.displayTime ?? this.formatSlotTime(item.slotStartAt);
  }

  toggleContinuousVisitMode() {
    this.continuousVisitMode.update((v) => !v);
  }

  toggleAllowShortGap() {
    this.allowShortGap.update((v) => !v);
  }

  currentMonthLabel(): string {
    const days = this.availabilityDays();
    const activeDateStr = this.activeItem()?.date || days[0]?.date || new Date().toISOString().slice(0, 10);
    const dt = new Date(activeDateStr);
    if (!Number.isFinite(dt.getTime())) return "Select Date";
    return dt.toLocaleDateString([], { month: "long", year: "numeric" });
  }

  prevDatePage() {
    this.dateOffset.update((curr) => Math.max(0, curr - 7));
  }

  nextDatePage() {
    const maxOffset = Math.max(0, this.availabilityDays().length - 7);
    this.dateOffset.update((curr) => Math.min(maxOffset, curr + 7));
  }

  selectNextAvailable() {
    for (const day of this.availabilityDays()) {
      for (const period of day.periods) {
        const slot = period.slots.find((s) => s.available && this.isSlotSelectable(s));
        if (slot) {
          this.setDate(day.date);
          this.selectActiveSlot(slot);
          return;
        }
      }
    }
  }

  selectThisWeek() {
    this.dateOffset.set(0);
    if (this.availabilityDays()[0]?.date) {
      this.setDate(this.availabilityDays()[0].date);
    }
  }

  joinWaitlist() {
    const dateLabel = this.selectedDateLabel();
    this.marketplace.error.set("");
    this.flowWarning.set(`You've been added to the waitlist for ${dateLabel}! We'll notify you if a slot opens up.`);
  }

  hasNoSlotsOnSelectedDate(): boolean {
    return !this.slotGroups().some((group) => group.slots.some((s) => s.available));
  }

  selectedDateLabel(): string {
    const day = this.selectedAvailabilityDay();
    if (!day) return "selected date";
    return `${day.dayLabel}, ${day.label}`;
  }

  allSlotsSelected(): boolean {
    const items = this.bookingItems();
    return items.length > 0 && items.every((i) => !!i.slotStartAt);
  }

  toggleSlotGroup(label: string) {
    this.collapsedSlotGroups.update((st) => ({ ...st, [label]: !st[label] }));
  }

  isSlotGroupCollapsed(label: string): boolean {
    return !!this.collapsedSlotGroups()[label];
  }

  isSlotStartSelected(slot: AvailabilitySlot): boolean {
    const first = this.bookingItems()[0];
    return first?.slotStartAt === slot.startAt;
  }

  showAlternativesPanel(): boolean {
    return this.continuousVisitMode() && this.bookingItems().length > 1 && !this.allSlotsSelected() && this.hasNoSlotsOnSelectedDate();
  }

  /** True when slots exist but none form a valid continuous sequence with current staff — the audit's "professionals not continuously available" case. */
  showContinuousConflict(): boolean {
    if (!this.continuousVisitMode() || this.bookingItems().length < 2 || this.allSlotsSelected() || this.hasNoSlotsOnSelectedDate()) {
      return false;
    }
    return !this.slotGroups().some((group) => group.slots.some((slot) => slot.available && this.isSlotSelectable(slot)));
  }

  selectNextAvailableDate() {
    const current = this.activeItem()?.date || "";
    for (const day of this.availabilityDays()) {
      if (day.date === current) continue;
      for (const period of day.periods) {
        const slot = period.slots.find((s) => s.available && this.isSlotSelectable(s));
        if (slot) {
          this.setDate(day.date);
          this.selectActiveSlot(slot);
          return;
        }
      }
    }
    this.flowWarning.set("No other dates with continuously available times were found in this window. Try another day or branch.");
  }

  formatHoldTimer(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  startHoldTimer() {
    this.slotHoldSeconds.set(300);
    this.slotExpiredWarning.set("");
    if (this.holdTimerInterval) clearInterval(this.holdTimerInterval);
    this.holdTimerInterval = setInterval(() => {
      const current = this.slotHoldSeconds();
      if (current === null || current <= 1) {
        clearInterval(this.holdTimerInterval);
        this.slotHoldSeconds.set(null);
        this.slotExpiredWarning.set("Your 5-minute slot reservation expired. Please pick a slot again.");
      } else {
        this.slotHoldSeconds.set(current - 1);
      }
    }, 1000);
  }

  selectActiveSlot(slot: AvailabilitySlot) {
    if (!this.isSlotSelectable(slot)) return;
    const selectedDate = this.activeItem()?.date || slot.startAt.slice(0, 10);

    if (this.continuousVisitMode()) {
      let currentMs = new Date(slot.startAt).getTime();
      const gapBuffer = this.allowShortGap() ? 15 * 60000 : 5 * 60000;

      this.bookingItems.update((items) => items.map((item) => {
        const service = this.serviceById(item.serviceId);
        const durationMs = (service?.durationMinutes || 20) * 60000;
        const itemStartIso = new Date(currentMs).toISOString();
        currentMs += durationMs + gapBuffer;
        return {
          ...item,
          date: selectedDate,
          slotStartAt: itemStartIso
        };
      }));

      this.startHoldTimer();
    } else {
      const currentIndex = this.activeItemIndex();
      this.bookingItems.update((items) => items.map((item, index) => {
        if (index === currentIndex) return { ...item, slotStartAt: slot.startAt };
        if (!item.date && selectedDate) return { ...item, date: selectedDate };
        return item;
      }));
      this.startHoldTimer();

      const nextUnsetIndex = this.bookingItems().findIndex((item, index) => index > currentIndex && !item.slotStartAt);
      const anyUnsetIndex = this.bookingItems().findIndex((item) => !item.slotStartAt);

      if (nextUnsetIndex !== -1) {
        this.activeItemIndex.set(nextUnsetIndex);
        void this.reloadAvailability();
      } else if (anyUnsetIndex !== -1 && anyUnsetIndex !== currentIndex) {
        this.activeItemIndex.set(anyUnsetIndex);
        void this.reloadAvailability();
      }
    }
  }

  isSlotSelectable(slot: AvailabilitySlot): boolean {
    if (!slot.available) return false;
    const items = this.bookingItems();
    if (!items.length) return false;

    if (this.continuousVisitMode()) {
      let currentMs = new Date(slot.startAt).getTime();
      if (!Number.isFinite(currentMs)) return false;
      const gapBuffer = this.allowShortGap() ? 15 * 60000 : 5 * 60000;

      const business = this.business();
      if (business?.closingTime) {
        const totalDurationMs = items.reduce((acc, item) => {
          const service = this.serviceById(item.serviceId);
          return acc + ((service?.durationMinutes || 20) * 60000) + gapBuffer;
        }, 0);
        const endVisitMs = currentMs + totalDurationMs;
        const closingDate = new Date(slot.startAt.slice(0, 10) + "T" + business.closingTime);
        if (Number.isFinite(closingDate.getTime()) && endVisitMs > closingDate.getTime()) {
          return false;
        }
      }

      const staffSchedule = new Map<string, Array<{ start: number; end: number }>>();
      for (const item of items) {
        const service = this.serviceById(item.serviceId);
        const durationMs = (service?.durationMinutes || 20) * 60000;
        const sStart = currentMs;
        const sEnd = sStart + durationMs;
        currentMs = sEnd + gapBuffer;

        if (item.staffId) {
          if (!staffSchedule.has(item.staffId)) staffSchedule.set(item.staffId, []);
          const existing = staffSchedule.get(item.staffId)!;
          if (existing.some((existingRange) => sStart < existingRange.end && existingRange.start < sEnd)) {
            return false;
          }
          existing.push({ start: sStart, end: sEnd });
        }
      }

      return true;
    }

    const activeService = this.activeService();
    if (!activeService) return false;
    const candidateStart = new Date(slot.startAt).getTime();
    const candidateEnd = new Date(slot.endAt || new Date(candidateStart + activeService.durationMinutes * 60000).toISOString()).getTime();
    if (!Number.isFinite(candidateStart) || !Number.isFinite(candidateEnd)) return false;

    return !this.bookingItems().some((item, index) => {
      if (index === this.activeItemIndex() || !item.slotStartAt) return false;
      const service = this.serviceById(item.serviceId);
      if (!service) return false;
      const start = new Date(item.slotStartAt).getTime();
      const end = start + service.durationMinutes * 60000;
      return candidateStart < end && start < candidateEnd;
    });
  }

  private formatSlotTime(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "Selected";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  private initialServiceIds(): string[] {
    const multi = this.route.snapshot.queryParamMap.get("serviceIds");
    const ids = multi ? multi.split(",") : [this.route.snapshot.queryParamMap.get("serviceId") || ""];
    return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  }

  private savePendingIntent() {
    const slug = this.slug();
    if (!slug) return;
    const intent: PendingBookingIntent = {
      slug,
      items: this.bookingItems(),
      activeItemIndex: this.activeItemIndex(),
      date: this.activeItem()?.date || "",
      step: this.currentBookingStep(),
      savedAt: Date.now()
    };
    try {
      localStorage.setItem(PENDING_BOOKING_INTENT_KEY, JSON.stringify(intent));
    } catch {
      // Booking can continue without local draft persistence.
    }
  }

  private restorePendingIntent() {
    try {
      if (this.hasExplicitBookingIntent()) {
        this.clearPendingIntent();
        return;
      }
      const raw = localStorage.getItem(PENDING_BOOKING_INTENT_KEY);
      if (!raw) return;
      const intent = JSON.parse(raw) as PendingBookingIntent;
      if (intent.slug !== this.slug()) return;
      if (Date.now() - Number(intent.savedAt || 0) > 30 * 60 * 1000) {
        this.clearPendingIntent();
        return;
      }
      if (intent.items?.length) {
        this.bookingItems.set(intent.items);
        this.activeItemIndex.set(Math.min(intent.activeItemIndex ?? 0, intent.items.length - 1));
      } else if (intent.serviceId) {
        this.bookingItems.set([{ serviceId: intent.serviceId, staffId: intent.staffId || null, date: intent.date || "", slotStartAt: intent.slotStartAt || "" }]);
      }
      if (intent.step >= 1 && intent.step <= 4) this.step.set(intent.step);
    } catch {
      this.clearPendingIntent();
    }
  }

  private hasExplicitBookingIntent(): boolean {
    const params = this.route.snapshot.queryParamMap;
    return ["serviceId", "serviceIds", "staffId", "date", "slotStartAt", "rescheduleBookingId", "rebookFrom"].some((key) => params.has(key));
  }

  private clearPendingIntent() {
    try {
      localStorage.removeItem(PENDING_BOOKING_INTENT_KEY);
    } catch {
      // Ignore unavailable storage.
    }
  }

  private profileComplete(customer: { profileComplete?: boolean; firstName?: string; lastName?: string; email?: string; phone?: string }): boolean {
    return Boolean(customer.profileComplete)
      || (!!String(customer.firstName || "").trim()
        && !!String(customer.lastName || "").trim()
        && !!String(customer.email || "").trim()
        && !!String(customer.phone || "").trim());
  }
}
