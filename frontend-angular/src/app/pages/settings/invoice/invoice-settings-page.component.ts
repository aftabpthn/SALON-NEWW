
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

type SettingsTab = 'common' | 'terms' | 'language';
type SettingsCategory = 'display' | 'print' | 'messages' | 'business';
type InvoiceToggleKey =
  | 'showBill' | 'showFeedbackLink' | 'showInvoiceLink' | 'headerIncludingLogo'
  | 'showBusinessName' | 'showInvoiceId' | 'showDateTime' | 'showPaymentMethod'
  | 'showStaff' | 'showTime' | 'showAppointmentTime' | 'showWalletBalance'
  | 'showPendingServices' | 'showClientName' | 'showClientContact' | 'showDiscount'
  | 'showBillNotes' | 'showDownloadButton' | 'showSignature' | 'showPackageOfferPrice';

interface InvoiceAppearanceSettings {
  layout: 'a4' | 'thermal';
  heading: string;
  invoiceNumberPrefix: string;
  thanksMessage: string;
  poweredBy: string;
  roomHeading: string;
  termsAndConditions: string;
  dualLanguageEnabled: boolean;
  secondaryLanguageName: string;
  englishLabels: InvoiceLanguageLabels;
  secondaryLabels: InvoiceLanguageLabels;
  showBill: boolean;
  showFeedbackLink: boolean;
  showInvoiceLink: boolean;
  headerIncludingLogo: boolean;
  showBusinessName: boolean;
  showInvoiceId: boolean;
  showDateTime: boolean;
  showPaymentMethod: boolean;
  showStaff: boolean;
  showTime: boolean;
  showAppointmentTime: boolean;
  showWalletBalance: boolean;
  showPendingServices: boolean;
  showClientName: boolean;
  showClientContact: boolean;
  showDiscount: boolean;
  showBillNotes: boolean;
  showDownloadButton: boolean;
  showSignature: boolean;
  showPackageOfferPrice: boolean;
}

interface InvoiceLanguageLabels {
  salonName: string;
  email: string;
  contact: string;
  address: string;
  thanksMessage: string;
  poweredBy: string;
  extraText1: string;
  extraText2: string;
  taxInvoiceText: string;
  gstin: string;
  date: string;
  invoiceId: string;
  customerName: string;
  customerContact: string;
  actualPrice: string;
  discountPercentage: string;
  taxableAmount: string;
  gst: string;
  total: string;
  paid: string;
  due: string;
  services: string;
  quantity: string;
  price: string;
  discount: string;
  product: string;
  package: string;
  membership: string;
  valid: string;
  staff: string;
  paymentMethod: string;
  appointmentTime: string;
  walletBalance: string;
  terms: string;
  signature: string;
  items: string;
  hsnSac: string;
  subtotal: string;
  time: string;
  pendingServices: string;
  billNotes: string;
  downloadInvoice: string;
  feedbackLink: string;
  invoiceLink: string;
  status: string;
  placeOfSupply: string;
  buyerGstin: string;
  cgst: string;
  sgst: string;
  igst: string;
  reverseCharge: string;
  upiPayment: string;
}

interface InvoiceBusinessProfile {
  legalName: string;
  tradeName: string;
  isGstRegistered: boolean;
  gstin: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  upiId: string;
  upiPayeeName: string;
}

interface ToggleOption {
  key: InvoiceToggleKey;
  label: string;
  category: SettingsCategory;
}

@Component({
    selector: 'app-invoice-settings-page',
    imports: [FormsModule, RouterLink],
    templateUrl: './invoice-settings-page.component.html',
    styleUrls: ['./invoice-settings-page.component.css']
})
export class InvoiceSettingsPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly branchName = localStorage.getItem('aurashine_branch_name')
    ?? localStorage.getItem('selectedBranchName')
    ?? localStorage.getItem('branchName')
    ?? 'Current branch';

  activeTab: SettingsTab = 'common';
  activeCategory: SettingsCategory = 'display';
  search = '';
  loading = true;
  saving = false;
  error = '';
  saved = '';
  settings = this.defaultSettings();
  profile = this.emptyProfile();
  private savedSettings = '';
  private savedProfile = '';
  private profileExists = false;

  readonly categories: Array<{ key: SettingsCategory; label: string }> = [
    { key: 'display', label: 'Display' },
    { key: 'print', label: 'Print' },
    { key: 'messages', label: 'Messages' },
    { key: 'business', label: 'Business' },
  ];

  readonly toggles: ToggleOption[] = [
    { key: 'headerIncludingLogo', label: 'Header including logo', category: 'display' },
    { key: 'showBusinessName', label: 'Business name', category: 'display' },
    { key: 'showInvoiceId', label: 'Invoice ID', category: 'display' },
    { key: 'showDateTime', label: 'Date & time', category: 'display' },
    { key: 'showPaymentMethod', label: 'Payment method', category: 'display' },
    { key: 'showStaff', label: 'Display staff', category: 'display' },
    { key: 'showTime', label: 'Display time', category: 'display' },
    { key: 'showAppointmentTime', label: 'Appointment time', category: 'display' },
    { key: 'showWalletBalance', label: 'E-wallet balance', category: 'display' },
    { key: 'showPendingServices', label: 'Pending services', category: 'display' },
    { key: 'showClientName', label: 'Client name', category: 'display' },
    { key: 'showClientContact', label: 'Client contact number', category: 'display' },
    { key: 'showDiscount', label: 'Discount', category: 'display' },
    { key: 'showBillNotes', label: 'Bill notes', category: 'display' },
    { key: 'showSignature', label: 'Signature', category: 'display' },
    { key: 'showPackageOfferPrice', label: 'Package offer price', category: 'display' },
    { key: 'showBill', label: 'Show bill', category: 'print' },
    { key: 'showDownloadButton', label: 'Download invoice button', category: 'print' },
    { key: 'showFeedbackLink', label: 'Feedback link', category: 'messages' },
    { key: 'showInvoiceLink', label: 'Invoice link', category: 'messages' },
  ];

  readonly languageFields: Array<{ key: keyof InvoiceLanguageLabels; label: string }> = [
    { key: 'salonName', label: 'Salon name' }, { key: 'email', label: 'Email' },
    { key: 'contact', label: 'Contact' }, { key: 'address', label: 'Address' },
    { key: 'gstin', label: 'GSTIN' }, { key: 'date', label: 'Date' },
    { key: 'invoiceId', label: 'Invoice ID' }, { key: 'customerName', label: 'Customer name' },
    { key: 'customerContact', label: 'Customer contact' }, { key: 'services', label: 'Services' },
    { key: 'product', label: 'Product' }, { key: 'package', label: 'Package' },
    { key: 'membership', label: 'Membership' }, { key: 'valid', label: 'Valid' },
    { key: 'staff', label: 'Staff' }, { key: 'quantity', label: 'Quantity' },
    { key: 'price', label: 'Price' }, { key: 'actualPrice', label: 'Actual price' },
    { key: 'discount', label: 'Discount' }, { key: 'discountPercentage', label: 'Discount percentage' },
    { key: 'taxableAmount', label: 'Taxable amount' }, { key: 'gst', label: 'GST' },
    { key: 'subtotal', label: 'Subtotal' }, { key: 'total', label: 'Total' },
    { key: 'paid', label: 'Paid' }, { key: 'due', label: 'Due' },
    { key: 'paymentMethod', label: 'Payment method' }, { key: 'appointmentTime', label: 'Appointment time' },
    { key: 'walletBalance', label: 'E-wallet balance' }, { key: 'items', label: 'Items' },
    { key: 'hsnSac', label: 'HSN/SAC' }, { key: 'terms', label: 'Terms' },
    { key: 'signature', label: 'Signature' }, { key: 'thanksMessage', label: 'Thanks message' },
    { key: 'poweredBy', label: 'Powered by' }, { key: 'taxInvoiceText', label: 'Tax invoice text' },
    { key: 'extraText1', label: 'Extra text 1' }, { key: 'extraText2', label: 'Extra text 2' },
    { key: 'time', label: 'Time' }, { key: 'pendingServices', label: 'Pending services' },
    { key: 'billNotes', label: 'Bill notes' }, { key: 'downloadInvoice', label: 'Download invoice' },
    { key: 'feedbackLink', label: 'Feedback link' }, { key: 'invoiceLink', label: 'Invoice link' },
    { key: 'status', label: 'Status' }, { key: 'placeOfSupply', label: 'Place of supply' },
    { key: 'buyerGstin', label: 'Buyer GSTIN' }, { key: 'cgst', label: 'CGST' },
    { key: 'sgst', label: 'SGST' }, { key: 'igst', label: 'IGST' },
    { key: 'reverseCharge', label: 'Reverse charge' }, { key: 'upiPayment', label: 'UPI payment' },
  ];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  get dirty(): boolean {
    return this.savedSettings !== JSON.stringify(this.settings)
      || this.savedProfile !== JSON.stringify(this.profile);
  }

  visibleToggles(): ToggleOption[] {
    const query = this.search.trim().toLowerCase();
    return this.toggles.filter((item) =>
      (query ? item.label.toLowerCase().includes(query) : item.category === this.activeCategory),
    );
  }

  selectCategory(category: SettingsCategory): void {
    this.activeCategory = category;
    this.search = '';
    this.saved = '';
  }

  setLayout(layout: 'a4' | 'thermal'): void {
    this.settings.layout = layout;
    this.saved = '';
  }

  toggle(key: InvoiceToggleKey): void {
    this.settings[key] = !this.settings[key];
    this.saved = '';
  }

  reset(): void {
    this.settings = this.defaultSettings();
    this.saved = '';
    this.error = '';
  }

  async save(): Promise<void> {
    if (this.saving) return;
    this.error = '';
    this.saved = '';
    if (this.profileChanged() && !this.validProfile()) return;
    this.saving = true;
    try {
      await firstValueFrom(this.api.put('/api/v1/settings/invoice-appearance', this.settings));
      if (this.profileChanged() && (this.profileExists || this.hasProfileData())) {
        await firstValueFrom(this.api.put('/api/v1/settings/invoice-business-profile', this.profile));
      }
      await this.load(false);
      this.saved = 'Saved';
    } catch (error: any) {
      this.error = error?.error?.error?.message ?? error?.error?.message ?? error?.message ?? 'Unable to save invoice settings';
    } finally {
      this.saving = false;
    }
  }

  trackByToggle(_: number, item: ToggleOption): string { return item.key; }
  trackByCategory(_: number, item: { key: SettingsCategory }): string { return item.key; }
  trackByLanguageField(_: number, item: { key: keyof InvoiceLanguageLabels }): string { return item.key; }

  invoiceLabel(key: keyof InvoiceLanguageLabels): string {
    const english = this.settings.englishLabels[key] || this.defaultEnglishLabels()[key];
    const secondary = this.settings.secondaryLabels[key]?.trim();
    return this.settings.dualLanguageEnabled && secondary ? `${english} / ${secondary}` : english;
  }

  private async load(showLoading = true): Promise<void> {
    if (showLoading) this.loading = true;
    this.error = '';
    try {
      const [settingsResponse, profileResponse] = await Promise.all([
        firstValueFrom(this.api.get<any>('/api/v1/settings/invoice-appearance')),
        firstValueFrom(this.api.get<any>('/api/v1/settings/invoice-business-profile')),
      ]);
      const loadedSettings = settingsResponse?.data ?? settingsResponse ?? {};
      this.settings = {
        ...this.defaultSettings(),
        ...loadedSettings,
        englishLabels: { ...this.defaultEnglishLabels(), ...(loadedSettings.englishLabels ?? {}) },
        secondaryLabels: { ...this.emptyLanguageLabels(), ...(loadedSettings.secondaryLabels ?? {}) },
      };
      const profile = profileResponse?.data ?? profileResponse ?? null;
      this.profileExists = !!profile;
      this.profile = profile ? { ...this.emptyProfile(), ...profile } : this.emptyProfile();
      this.savedSettings = JSON.stringify(this.settings);
      this.savedProfile = JSON.stringify(this.profile);
    } catch (error: any) {
      this.error = error?.error?.error?.message ?? error?.error?.message ?? 'Unable to load invoice settings';
    } finally {
      this.loading = false;
    }
  }

  private profileChanged(): boolean { return this.savedProfile !== JSON.stringify(this.profile); }
  private hasProfileData(): boolean { return Object.values(this.profile).some((value) => typeof value === 'boolean' ? value : !!String(value).trim()); }

  private validProfile(): boolean {
    if (!this.profileExists && !this.hasProfileData()) return true;
    if (!this.profile.legalName.trim() || !this.profile.addressLine1.trim() || !this.profile.city.trim() || !this.profile.state.trim() || !this.profile.pincode.trim()) {
      this.error = 'Business name, address, city, state and pincode are required';
      return false;
    }
    if (this.profile.isGstRegistered && !/^[A-Z0-9]{15}$/.test(this.profile.gstin.trim().toUpperCase())) {
      this.error = 'Enter a valid 15-character GSTIN';
      return false;
    }
    return true;
  }

  private defaultSettings(): InvoiceAppearanceSettings {
    return {
      layout: 'a4', heading: 'INVOICE', invoiceNumberPrefix: '', thanksMessage: '', poweredBy: '', roomHeading: '', termsAndConditions: '',
      dualLanguageEnabled: false, secondaryLanguageName: '',
      englishLabels: this.defaultEnglishLabels(), secondaryLabels: this.emptyLanguageLabels(),
      showBill: true, showFeedbackLink: true, showInvoiceLink: true, headerIncludingLogo: true,
      showBusinessName: true, showInvoiceId: true, showDateTime: true, showPaymentMethod: true,
      showStaff: true, showTime: true, showAppointmentTime: true, showWalletBalance: true,
      showPendingServices: true, showClientName: true, showClientContact: true, showDiscount: true,
      showBillNotes: true, showDownloadButton: true, showSignature: true, showPackageOfferPrice: true,
    };
  }

  private defaultEnglishLabels(): InvoiceLanguageLabels {
    return {
      salonName: 'Business name', email: 'Email', contact: 'Contact', address: 'Address',
      thanksMessage: 'Thank you', poweredBy: 'Powered by', extraText1: 'Extra text 1', extraText2: 'Extra text 2',
      taxInvoiceText: 'Tax invoice', gstin: 'GSTIN', date: 'Date', invoiceId: 'Invoice ID',
      customerName: 'Customer', customerContact: 'Contact number', actualPrice: 'Actual price',
      discountPercentage: 'Discount %', taxableAmount: 'Taxable amount', gst: 'GST', total: 'Total',
      paid: 'Paid', due: 'Due', services: 'Services', quantity: 'Qty', price: 'Price', discount: 'Discount',
      product: 'Product', package: 'Package', membership: 'Membership', valid: 'Valid', staff: 'Staff',
      paymentMethod: 'Payment method', appointmentTime: 'Appointment time', walletBalance: 'E-wallet balance',
      terms: 'Terms', signature: 'Signature', items: 'Item', hsnSac: 'HSN/SAC', subtotal: 'Subtotal',
      time: 'Time', pendingServices: 'Pending services', billNotes: 'Bill notes', downloadInvoice: 'Download invoice',
      feedbackLink: 'Feedback link', invoiceLink: 'Invoice link', status: 'Status', placeOfSupply: 'Place of supply',
      buyerGstin: 'Buyer GSTIN', cgst: 'CGST', sgst: 'SGST', igst: 'IGST', reverseCharge: 'Reverse charge',
      upiPayment: 'UPI payment',
    };
  }

  private emptyLanguageLabels(): InvoiceLanguageLabels {
    return Object.fromEntries(Object.keys(this.defaultEnglishLabels()).map((key) => [key, ''])) as unknown as InvoiceLanguageLabels;
  }

  private emptyProfile(): InvoiceBusinessProfile {
    return {
      legalName: '', tradeName: '', isGstRegistered: false, gstin: '', addressLine1: '', addressLine2: '',
      city: '', state: '', pincode: '', phone: '', email: '', upiId: '', upiPayeeName: '',
    };
  }
}
