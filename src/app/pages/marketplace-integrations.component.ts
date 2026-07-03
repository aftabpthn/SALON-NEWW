import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { catchError, finalize, forkJoin, map, of, switchMap } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type FieldType = 'text' | 'password' | 'email' | 'url' | 'number' | 'select' | 'textarea';

type IntegrationField = {
  key: string;
  label: string;
  placeholder: string;
  type?: FieldType;
  required?: boolean;
  sensitive?: boolean;
  options?: string[];
};

type SetupOutput = {
  label: string;
  kind: 'embed' | 'webhook' | 'redirect' | 'callback';
};

type IntegrationCard = {
  key: string;
  category: string;
  name: string;
  logo: string;
  accent: string;
  region?: string;
  paymentModes?: string[];
  featured?: boolean;
  description: string;
  setupTitle: string;
  setupBody: string;
  fields: IntegrationField[];
  scopes: string[];
  steps: string[];
  outputs?: SetupOutput[];
};

type IntegrationCategory = {
  key: string;
  title: string;
  integrations: IntegrationCard[];
};

type IntegrationCardMeta = Pick<Partial<IntegrationCard>, 'region' | 'paymentModes' | 'featured'>;

type MarketplaceConnection = ApiRecord & {
  id: string;
  provider: string;
  accountName?: string;
  branchId?: string;
  credentials?: ApiRecord;
  scopes?: string[];
  health?: ApiRecord;
  status?: string;
  lastSyncAt?: string;
};

const modeField: IntegrationField = {
  key: 'mode',
  label: 'Mode',
  placeholder: 'Select mode',
  type: 'select',
  options: ['test', 'live'],
  required: true
};

const accountField: IntegrationField = {
  key: 'accountName',
  label: 'Account name',
  placeholder: 'Main salon account',
  required: true
};

const paymentFields = {
  cash: [
    accountField,
    { key: 'cashDrawerName', label: 'Cash drawer', placeholder: 'Front desk cash drawer', required: true },
    { key: 'openingFloat', label: 'Opening float', placeholder: '5000', type: 'number' },
    { key: 'settlementUser', label: 'Settlement owner', placeholder: 'Manager or cashier name' }
  ],
  razorpay: [
    accountField,
    modeField,
    { key: 'keyId', label: 'Razorpay API Key', placeholder: 'rzp_test_xxxxx', sensitive: true, required: true },
    { key: 'keySecret', label: 'Razorpay Secret Key', placeholder: 'Enter Razorpay secret key', type: 'password', sensitive: true, required: true },
    { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Payment webhook secret', type: 'password', sensitive: true }
  ],
  stripe: [
    accountField,
    modeField,
    { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_test_xxxxx', sensitive: true, required: true },
    { key: 'secretKey', label: 'Secret Key', placeholder: 'sk_test_xxxxx', type: 'password', sensitive: true, required: true },
    { key: 'webhookSecret', label: 'Webhook Signing Secret', placeholder: 'whsec_xxxxx', type: 'password', sensitive: true }
  ],
  paypal: [
    accountField,
    modeField,
    { key: 'clientId', label: 'Client ID', placeholder: 'PayPal client ID', sensitive: true, required: true },
    { key: 'clientSecret', label: 'Client Secret', placeholder: 'PayPal secret', type: 'password', sensitive: true, required: true },
    { key: 'merchantId', label: 'Merchant ID', placeholder: 'Merchant account ID' }
  ],
  terminal: [
    accountField,
    modeField,
    { key: 'locationId', label: 'Terminal location ID', placeholder: 'Store or terminal location', required: true },
    { key: 'apiKey', label: 'Terminal API Key', placeholder: 'Reader API key', type: 'password', sensitive: true, required: true },
    { key: 'deviceSerial', label: 'Device serial', placeholder: 'Reader serial number' }
  ],
  merchant: [
    accountField,
    modeField,
    { key: 'merchantId', label: 'Merchant ID', placeholder: 'Merchant or store ID', required: true },
    { key: 'apiKey', label: 'API Key', placeholder: 'Provider API key', type: 'password', sensitive: true, required: true },
    { key: 'secretKey', label: 'Secret Key', placeholder: 'Provider secret key', type: 'password', sensitive: true }
  ],
  indiaGateway: [
    accountField,
    modeField,
    { key: 'merchantId', label: 'Merchant ID', placeholder: 'Provider merchant ID', required: true },
    { key: 'apiKey', label: 'API Key', placeholder: 'Payment gateway API key', type: 'password', sensitive: true, required: true },
    { key: 'secretKey', label: 'Secret Key', placeholder: 'Payment gateway secret', type: 'password', sensitive: true, required: true },
    { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Webhook signing secret', type: 'password', sensitive: true }
  ],
  upi: [
    accountField,
    modeField,
    { key: 'merchantVpa', label: 'Merchant UPI ID / VPA', placeholder: 'aurashine@bank', required: true },
    { key: 'merchantId', label: 'Merchant ID', placeholder: 'UPI merchant ID' },
    { key: 'qrReference', label: 'Static QR reference', placeholder: 'QR terminal or store code' },
    { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'UPI payment webhook secret', type: 'password', sensitive: true }
  ],
  wallet: [
    accountField,
    modeField,
    { key: 'merchantId', label: 'Wallet merchant ID', placeholder: 'Wallet merchant ID', required: true },
    { key: 'apiKey', label: 'API Key', placeholder: 'Wallet API key', type: 'password', sensitive: true, required: true },
    { key: 'secretKey', label: 'Secret Key', placeholder: 'Wallet secret', type: 'password', sensitive: true }
  ],
  bnpl: [
    accountField,
    modeField,
    { key: 'merchantId', label: 'Merchant ID', placeholder: 'BNPL merchant ID', required: true },
    { key: 'apiKey', label: 'API Key', placeholder: 'BNPL API key', type: 'password', sensitive: true, required: true },
    { key: 'settlementAccount', label: 'Settlement account', placeholder: 'Bank settlement account ID' }
  ],
  bankTransfer: [
    accountField,
    { key: 'bankName', label: 'Bank name', placeholder: 'HDFC, ICICI, SBI', required: true },
    { key: 'accountNumber', label: 'Account number', placeholder: 'Settlement account number', sensitive: true, required: true },
    { key: 'ifscOrSwift', label: 'IFSC / SWIFT', placeholder: 'IFSC for India or SWIFT for global wires', required: true },
    { key: 'beneficiaryName', label: 'Beneficiary name', placeholder: 'Business legal name', required: true }
  ],
  globalGateway: [
    accountField,
    modeField,
    { key: 'merchantId', label: 'Merchant / Account ID', placeholder: 'Gateway merchant ID', required: true },
    { key: 'clientId', label: 'Client ID', placeholder: 'OAuth or API client ID', sensitive: true },
    { key: 'apiKey', label: 'API Key', placeholder: 'Gateway API key', type: 'password', sensitive: true, required: true },
    { key: 'secretKey', label: 'Secret Key', placeholder: 'Gateway secret key', type: 'password', sensitive: true }
  ],
  localMethod: [
    accountField,
    modeField,
    { key: 'merchantId', label: 'Merchant ID', placeholder: 'Local payment merchant ID', required: true },
    { key: 'apiKey', label: 'API Key', placeholder: 'Local method API key', type: 'password', sensitive: true, required: true },
    { key: 'callbackSecret', label: 'Callback Secret', placeholder: 'Payment callback secret', type: 'password', sensitive: true }
  ],
  directDebit: [
    accountField,
    modeField,
    { key: 'creditorId', label: 'Creditor / Originator ID', placeholder: 'SEPA, ACH or BECS originator ID', required: true },
    { key: 'apiKey', label: 'API Key', placeholder: 'Direct debit provider API key', type: 'password', sensitive: true, required: true },
    { key: 'mandateWebhookSecret', label: 'Mandate webhook secret', placeholder: 'Mandate webhook secret', type: 'password', sensitive: true }
  ]
} satisfies Record<string, IntegrationField[]>;

const notificationFields = {
  sms: [
    accountField,
    { key: 'providerName', label: 'SMS provider', placeholder: 'MSG91, Textlocal, custom gateway', required: true },
    { key: 'apiKey', label: 'SMS API Key', placeholder: 'Gateway API key', type: 'password', sensitive: true, required: true },
    { key: 'senderId', label: 'Sender ID', placeholder: 'AURASL' },
    { key: 'templateId', label: 'Default template ID', placeholder: 'DLT template ID' }
  ],
  email: [
    accountField,
    { key: 'apiKey', label: 'API Key', placeholder: 'Email provider API key', type: 'password', sensitive: true, required: true },
    { key: 'listId', label: 'List or audience ID', placeholder: 'Marketing list ID' },
    { key: 'fromEmail', label: 'From email', placeholder: 'offers@aurashine.com', type: 'email' }
  ],
  smtp: [
    accountField,
    { key: 'host', label: 'SMTP host', placeholder: 'smtp.example.com', required: true },
    { key: 'port', label: 'Port', placeholder: '587', type: 'number', required: true },
    { key: 'username', label: 'Username', placeholder: 'SMTP username', required: true },
    { key: 'password', label: 'Password', placeholder: 'SMTP password', type: 'password', sensitive: true, required: true },
    { key: 'fromEmail', label: 'From email', placeholder: 'notifications@aurashine.com', type: 'email' }
  ],
  whatsapp: [
    accountField,
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: 'WhatsApp phone number ID', required: true },
    { key: 'businessAccountId', label: 'Business Account ID', placeholder: 'Meta WABA ID', required: true },
    { key: 'accessToken', label: 'Access Token', placeholder: 'Permanent access token', type: 'password', sensitive: true, required: true },
    { key: 'verifyToken', label: 'Verify Token', placeholder: 'Webhook verify token', type: 'password', sensitive: true }
  ],
  whatsappApi: [
    accountField,
    { key: 'apiKey', label: 'API Key', placeholder: 'Provider API key', type: 'password', sensitive: true, required: true },
    { key: 'channelId', label: 'Channel ID', placeholder: 'WhatsApp channel or bot ID' },
    { key: 'campaignName', label: 'Default campaign', placeholder: 'Review, booking, reminders' }
  ]
} satisfies Record<string, IntegrationField[]>;

const catalog: IntegrationCategory[] = [
  {
    key: 'payments-india',
    title: 'India Payment Modes',
    integrations: [
      card('cash-counter', 'payments-india', 'Cash Counter', 'CASH', '#334155', 'Track cash payments, drawer settlement and cashier handover.', 'Configure cash payment mode', paymentFields.cash, ['cash', 'settlement', 'pos'], [], { region: 'India', paymentModes: ['Cash', 'Drawer closing'] }),
      card('upi-bhim-qr', 'payments-india', 'UPI / BHIM QR', 'UPI', '#0f8f79', 'Accept UPI collect, intent, static QR and dynamic QR payments.', 'Configure UPI payment collection', paymentFields.upi, ['upi', 'qr', 'webhooks'], [], { region: 'India', paymentModes: ['UPI Collect', 'Intent', 'QR'] }),
      card('google-pay-india', 'payments-india', 'Google Pay Business', 'GPay', '#4285f4', 'Accept Google Pay UPI payments and reconcile booking collections.', 'Connect Google Pay Business for UPI', paymentFields.upi, ['upi', 'qr'], [], { region: 'India', paymentModes: ['UPI', 'QR'] }),
      card('phonepe-pg', 'payments-india', 'PhonePe Payment Gateway', 'PPe', '#5f259f', 'Accept UPI, cards, wallets and net banking through PhonePe.', 'Connect PhonePe Payment Gateway', paymentFields.indiaGateway, ['upi', 'cards', 'netbanking', 'wallets'], [], { region: 'India', paymentModes: ['UPI', 'Cards', 'NetBanking'] }),
      card('paytm-pg', 'payments-india', 'Paytm Payment Gateway', 'PTM', '#00baf2', 'Accept Paytm wallet, UPI, cards and net banking.', 'Connect Paytm Payment Gateway', paymentFields.indiaGateway, ['upi', 'wallets', 'cards', 'netbanking'], [], { region: 'India', paymentModes: ['Wallet', 'UPI', 'Cards'] }),
      card('razorpay', 'payments-india', 'Razorpay', 'RZP', '#1b66e5', 'Accept Indian cards, UPI, net banking, EMI and payment links.', 'Save time and accept payments using Razorpay', paymentFields.razorpay, ['payments', 'upi', 'emi', 'refunds', 'webhooks'], [], { region: 'India', paymentModes: ['UPI', 'Cards', 'EMI'], featured: true }),
      card('cashfree', 'payments-india', 'Cashfree Payments', 'CF', '#6936f5', 'Accept UPI, cards, wallets, pay later and payouts through Cashfree.', 'Connect Cashfree Payments', paymentFields.indiaGateway, ['upi', 'cards', 'wallets', 'payouts'], [], { region: 'India', paymentModes: ['UPI', 'Payouts', 'Pay Later'] }),
      card('payu', 'payments-india', 'PayU India', 'PayU', '#9acd32', 'Accept cards, UPI, EMI, net banking and wallets through PayU.', 'Connect PayU payment gateway', paymentFields.indiaGateway, ['upi', 'cards', 'emi', 'netbanking'], [], { region: 'India', paymentModes: ['Cards', 'UPI', 'EMI'] }),
      card('ccavenue', 'payments-india', 'CCAvenue', 'CCA', '#f97316', 'Accept cards, UPI, net banking, wallets and EMI through CCAvenue.', 'Connect CCAvenue payments', paymentFields.indiaGateway, ['cards', 'upi', 'wallets', 'netbanking'], [], { region: 'India', paymentModes: ['Cards', 'UPI', 'Wallets'] }),
      card('billdesk', 'payments-india', 'BillDesk', 'BD', '#154c9c', 'Accept enterprise bill payments, cards, UPI and net banking.', 'Connect BillDesk payments', paymentFields.indiaGateway, ['bills', 'upi', 'cards', 'netbanking'], [], { region: 'India', paymentModes: ['Bills', 'UPI', 'NetBanking'] }),
      card('juspay', 'payments-india', 'Juspay', 'JUSP', '#111827', 'Route Indian payments across gateways with orchestration and retries.', 'Connect Juspay payment orchestration', paymentFields.indiaGateway, ['orchestration', 'upi', 'cards'], [], { region: 'India', paymentModes: ['Routing', 'UPI', 'Cards'] }),
      card('easebuzz', 'payments-india', 'Easebuzz', 'EBZ', '#00a86b', 'Accept UPI, cards, net banking, payment links and subscription payments.', 'Connect Easebuzz payments', paymentFields.indiaGateway, ['upi', 'cards', 'payment-links', 'subscriptions'], [], { region: 'India', paymentModes: ['Links', 'UPI', 'Cards'] }),
      card('instamojo', 'payments-india', 'Instamojo', 'IMJ', '#10b981', 'Collect payments using links, UPI, cards and wallet-friendly checkout.', 'Connect Instamojo payments', paymentFields.indiaGateway, ['payment-links', 'upi', 'cards'], [], { region: 'India', paymentModes: ['Links', 'UPI', 'Cards'] }),
      card('atom-ntt-data', 'payments-india', 'NTT DATA / Atom', 'ATOM', '#4B1238', 'Accept cards, UPI and net banking through Atom/NTT DATA.', 'Connect NTT DATA Atom payments', paymentFields.indiaGateway, ['upi', 'cards', 'netbanking'], [], { region: 'India', paymentModes: ['Cards', 'UPI', 'NetBanking'] }),
      card('worldline-india', 'payments-india', 'Worldline India', 'WLI', '#005eb8', 'Connect Worldline India gateway and in-store acceptance.', 'Connect Worldline India payments', paymentFields.indiaGateway, ['gateway', 'terminal', 'upi'], [], { region: 'India', paymentModes: ['Gateway', 'POS', 'UPI'] }),
      card('payg', 'payments-india', 'PayG', 'PayG', '#2563eb', 'Accept online payments, links and recurring collections using PayG.', 'Connect PayG payments', paymentFields.indiaGateway, ['cards', 'upi', 'links'], [], { region: 'India', paymentModes: ['Links', 'Cards', 'UPI'] }),
      card('zaakpay', 'payments-india', 'Zaakpay', 'ZP', '#dc2626', 'Accept UPI, cards and net banking through Zaakpay.', 'Connect Zaakpay payments', paymentFields.indiaGateway, ['upi', 'cards', 'netbanking'], [], { region: 'India', paymentModes: ['UPI', 'Cards', 'NetBanking'] }),
      card('bharatpe-qr', 'payments-india', 'BharatPe QR', 'BP', '#00a76f', 'Accept UPI QR payments at the salon counter.', 'Connect BharatPe QR payments', paymentFields.upi, ['upi', 'qr', 'pos'], [], { region: 'India', paymentModes: ['UPI QR', 'Counter'] }),
      card('mobikwik-wallet', 'payments-india', 'MobiKwik Wallet', 'MBK', '#0066ff', 'Accept wallet and BNPL-friendly checkout through MobiKwik.', 'Connect MobiKwik wallet', paymentFields.wallet, ['wallets', 'bnpl'], [], { region: 'India', paymentModes: ['Wallet', 'Pay Later'] }),
      card('freecharge-wallet', 'payments-india', 'Freecharge Wallet', 'FC', '#f97316', 'Accept wallet payments and customer offer campaigns through Freecharge.', 'Connect Freecharge wallet', paymentFields.wallet, ['wallets', 'offers'], [], { region: 'India', paymentModes: ['Wallet', 'Offers'] }),
      card('netbanking-bank-transfer', 'payments-india', 'NetBanking / Bank Transfer', 'BANK', '#1e3a8a', 'Track NEFT, RTGS, IMPS and net banking settlement references.', 'Configure bank transfer payments', paymentFields.bankTransfer, ['netbanking', 'neft', 'rtgs', 'imps'], [], { region: 'India', paymentModes: ['NEFT', 'RTGS', 'IMPS'] }),
      card('card-rupay-emi', 'payments-india', 'Cards / RuPay / EMI', 'CARD', '#7c3aed', 'Configure card, RuPay, debit card EMI and credit card EMI acceptance.', 'Configure card and EMI payment mode', paymentFields.indiaGateway, ['cards', 'rupay', 'emi'], [], { region: 'India', paymentModes: ['RuPay', 'Credit Card', 'EMI'] }),
      card('simpl-pay-later', 'payments-india', 'Simpl Pay Later', 'SIM', '#0ea5e9', 'Enable pay-later checkout for eligible Indian customers.', 'Connect Simpl Pay Later', paymentFields.bnpl, ['bnpl', 'pay-later'], [], { region: 'India', paymentModes: ['Pay Later'] }),
      card('lazypay', 'payments-india', 'LazyPay', 'LP', '#e11d48', 'Enable cardless EMI and pay-later checkout through LazyPay.', 'Connect LazyPay', paymentFields.bnpl, ['bnpl', 'emi'], [], { region: 'India', paymentModes: ['BNPL', 'EMI'] }),
      card('zestmoney', 'payments-india', 'ZestMoney EMI', 'ZEST', '#4f46e5', 'Configure cardless EMI options for higher-ticket salon packages.', 'Connect ZestMoney EMI', paymentFields.bnpl, ['emi', 'bnpl'], [], { region: 'India', paymentModes: ['Cardless EMI'] }),
      card('pinelabs-reader', 'payments-india', 'Pine Labs Reader', 'PIN', '#4B1238', 'Connect Pine Labs readers for front desk billing.', 'Connect Pine Labs reader', paymentFields.terminal, ['terminal', 'cards', 'upi'], [], { region: 'India', paymentModes: ['POS', 'Cards', 'UPI'] }),
      card('mswipe-pos', 'payments-india', 'Mswipe POS', 'MSW', '#ef4444', 'Connect Mswipe terminals for card and UPI acceptance.', 'Connect Mswipe POS', paymentFields.terminal, ['terminal', 'cards', 'upi'], [], { region: 'India', paymentModes: ['POS', 'Cards', 'UPI'] }),
      card('paytm-pos', 'payments-india', 'Paytm POS', 'POS', '#00baf2', 'Connect Paytm POS devices for counter payments.', 'Connect Paytm POS', paymentFields.terminal, ['terminal', 'wallets', 'upi', 'cards'], [], { region: 'India', paymentModes: ['POS', 'Wallet', 'UPI'] })
    ]
  },
  {
    key: 'payments-global',
    title: 'Global Payment Modes',
    integrations: [
      card('stripe', 'payments-global', 'Stripe', 'STR', '#635bff', 'Accept cards, wallets, bank debits and local payment methods using Stripe.', 'Accept payments using Stripe', paymentFields.stripe, ['cards', 'wallets', 'bank-debits', 'webhooks'], [], { region: 'Global', paymentModes: ['Cards', 'Wallets', 'Local Methods'], featured: true }),
      card('paypal', 'payments-global', 'PayPal', 'PP', '#003087', 'Accept PayPal wallet, cards and PayPal checkout for online bookings.', 'Enable PayPal checkout', paymentFields.paypal, ['wallets', 'cards', 'refunds'], [], { region: 'Global', paymentModes: ['Wallet', 'Cards'] }),
      card('adyen', 'payments-global', 'Adyen', 'ADY', '#0abf53', 'Enterprise payment orchestration for cards, wallets and local methods.', 'Connect Adyen payments', paymentFields.globalGateway, ['orchestration', 'cards', 'wallets', 'local-methods'], [], { region: 'Global', paymentModes: ['Cards', 'Wallets', 'Local'] }),
      card('square', 'payments-global', 'Square', 'SQ', '#111827', 'Accept online, POS and terminal payments using Square.', 'Connect Square payments', paymentFields.globalGateway, ['pos', 'terminal', 'online-payments'], [], { region: 'Global', paymentModes: ['POS', 'Terminal', 'Online'] }),
      card('braintree', 'payments-global', 'Braintree', 'BT', '#0f2e5f', 'Accept cards, PayPal, Venmo and wallet payments through Braintree.', 'Connect Braintree payments', paymentFields.globalGateway, ['cards', 'paypal', 'venmo', 'wallets'], [], { region: 'Global', paymentModes: ['Cards', 'PayPal', 'Venmo'] }),
      card('checkout-com', 'payments-global', 'Checkout.com', 'CKO', '#111827', 'Accept global cards, local methods and risk-managed payments.', 'Connect Checkout.com', paymentFields.globalGateway, ['cards', 'local-methods', 'risk'], [], { region: 'Global', paymentModes: ['Cards', 'Local', 'Risk'] }),
      card('worldpay', 'payments-global', 'Worldpay', 'WPAY', '#f59e0b', 'Accept cards and enterprise merchant payments using Worldpay.', 'Connect Worldpay payments', paymentFields.globalGateway, ['cards', 'merchant-acquiring'], [], { region: 'Global', paymentModes: ['Cards', 'Acquiring'] }),
      card('authorize-net', 'payments-global', 'Authorize.Net', 'AUTH', '#126b8f', 'Accept card payments using Authorize.Net.', 'Connect Authorize.Net payments', paymentFields.merchant, ['cards', 'payments'], [], { region: 'US', paymentModes: ['Cards'] }),
      card('verifone-2checkout', 'payments-global', '2Checkout / Verifone', '2CO', '#2563eb', 'Accept international card and digital commerce payments.', 'Connect 2Checkout Verifone', paymentFields.globalGateway, ['cards', 'digital-commerce'], [], { region: 'Global', paymentModes: ['Cards', 'Commerce'] }),
      card('mollie', 'payments-global', 'Mollie', 'MOL', '#0095ff', 'Accept European cards, iDEAL, Bancontact, SEPA and wallets.', 'Connect Mollie payments', paymentFields.globalGateway, ['cards', 'ideal', 'bancontact', 'sepa'], [], { region: 'Europe', paymentModes: ['iDEAL', 'SEPA', 'Cards'] }),
      card('stripe-reader', 'payments-global', 'Stripe Reader', 'SR', '#1f2937', 'Connect Stripe Terminal readers for in-salon checkout.', 'Connect your Stripe card reader', paymentFields.terminal, ['terminal', 'payments'], [], { region: 'Global', paymentModes: ['Terminal', 'Cards'] }),
      card('clover-payment', 'payments-global', 'Clover Payment', 'CLV', '#14892c', 'Sync Clover payment terminals with salon checkout.', 'Connect Clover merchant payments', paymentFields.merchant, ['terminal', 'payments'], [], { region: 'US/Canada', paymentModes: ['POS', 'Cards'] }),
      card('apple-pay', 'payments-global', 'Apple Pay', 'APay', '#111827', 'Enable Apple Pay for fast card wallet checkout.', 'Configure Apple Pay', paymentFields.localMethod, ['wallets', 'cards'], [], { region: 'Global', paymentModes: ['Wallet', 'Cards'] }),
      card('google-pay-global', 'payments-global', 'Google Pay', 'GPay', '#4285f4', 'Enable Google Pay wallet checkout outside India.', 'Configure Google Pay wallet', paymentFields.localMethod, ['wallets', 'cards'], [], { region: 'Global', paymentModes: ['Wallet', 'Cards'] }),
      card('samsung-pay', 'payments-global', 'Samsung Pay', 'SPay', '#1428a0', 'Accept Samsung Pay wallet payments at checkout.', 'Configure Samsung Pay', paymentFields.localMethod, ['wallets', 'cards'], [], { region: 'Global', paymentModes: ['Wallet'] }),
      card('cash-app-pay', 'payments-global', 'Cash App Pay', 'CAP', '#00d632', 'Accept Cash App Pay for US customers.', 'Connect Cash App Pay', paymentFields.localMethod, ['wallets', 'us'], [], { region: 'US', paymentModes: ['Wallet'] }),
      card('venmo', 'payments-global', 'Venmo', 'VEN', '#008cff', 'Accept Venmo wallet payments through supported processors.', 'Connect Venmo payments', paymentFields.localMethod, ['wallets', 'us'], [], { region: 'US', paymentModes: ['Wallet'] }),
      card('ach-debit', 'payments-global', 'ACH Direct Debit', 'ACH', '#4B1238', 'Collect US bank account payments and recurring debits.', 'Configure ACH debit', paymentFields.directDebit, ['bank-debit', 'recurring', 'us'], [], { region: 'US', paymentModes: ['Bank debit'] }),
      card('sepa-debit', 'payments-global', 'SEPA Direct Debit', 'SEPA', '#1d4ed8', 'Collect euro-denominated bank debits across SEPA countries.', 'Configure SEPA debit', paymentFields.directDebit, ['bank-debit', 'recurring', 'europe'], [], { region: 'Europe', paymentModes: ['Bank debit'] }),
      card('ideal', 'payments-global', 'iDEAL', 'iD', '#cc0066', 'Accept Netherlands bank redirect payments using iDEAL.', 'Connect iDEAL payments', paymentFields.localMethod, ['bank-redirect', 'netherlands'], [], { region: 'Netherlands', paymentModes: ['Bank redirect'] }),
      card('bancontact', 'payments-global', 'Bancontact', 'BC', '#005498', 'Accept Belgian card and app payments through Bancontact.', 'Connect Bancontact', paymentFields.localMethod, ['cards', 'belgium'], [], { region: 'Belgium', paymentModes: ['Card', 'App'] }),
      card('sofort-klarna-pay-now', 'payments-global', 'Sofort / Klarna Pay Now', 'SOF', '#ffb3c7', 'Accept bank redirect payments in supported European markets.', 'Connect Sofort payments', paymentFields.localMethod, ['bank-redirect', 'europe'], [], { region: 'Europe', paymentModes: ['Bank redirect'] }),
      card('eps', 'payments-global', 'EPS', 'EPS', '#dc2626', 'Accept Austrian bank transfer checkout through EPS.', 'Connect EPS payments', paymentFields.localMethod, ['bank-redirect', 'austria'], [], { region: 'Austria', paymentModes: ['Bank redirect'] }),
      card('przelewy24', 'payments-global', 'Przelewy24', 'P24', '#d91f26', 'Accept Polish bank transfer and local checkout payments.', 'Connect Przelewy24', paymentFields.localMethod, ['bank-redirect', 'poland'], [], { region: 'Poland', paymentModes: ['Bank redirect'] }),
      card('blik', 'payments-global', 'BLIK', 'BLIK', '#111827', 'Accept Polish mobile code payments through BLIK.', 'Connect BLIK payments', paymentFields.localMethod, ['mobile-payments', 'poland'], [], { region: 'Poland', paymentModes: ['Mobile code'] }),
      card('swish', 'payments-global', 'Swish', 'SWS', '#ef4444', 'Accept Swedish mobile payments through Swish.', 'Connect Swish payments', paymentFields.localMethod, ['mobile-payments', 'sweden'], [], { region: 'Sweden', paymentModes: ['Mobile'] }),
      card('mobilepay', 'payments-global', 'MobilePay', 'MP', '#5b5ce2', 'Accept Nordic mobile wallet payments using MobilePay.', 'Connect MobilePay', paymentFields.localMethod, ['mobile-payments', 'nordics'], [], { region: 'Nordics', paymentModes: ['Mobile wallet'] }),
      card('vipps', 'payments-global', 'Vipps', 'VIP', '#ff5b24', 'Accept Norwegian mobile wallet payments using Vipps.', 'Connect Vipps payments', paymentFields.localMethod, ['mobile-payments', 'norway'], [], { region: 'Norway', paymentModes: ['Mobile wallet'] }),
      card('klarna', 'payments-global', 'Klarna', 'KLR', '#ffb3c7', 'Enable pay later, installments and Klarna checkout.', 'Connect Klarna payments', paymentFields.bnpl, ['bnpl', 'installments'], [], { region: 'Global', paymentModes: ['BNPL', 'Installments'] }),
      card('afterpay-clearpay', 'payments-global', 'Afterpay / Clearpay', 'AP', '#00a76f', 'Enable buy-now-pay-later payments through Afterpay or Clearpay.', 'Connect Afterpay Clearpay', paymentFields.bnpl, ['bnpl', 'installments'], [], { region: 'Global', paymentModes: ['BNPL'] }),
      card('affirm', 'payments-global', 'Affirm', 'AF', '#4f46e5', 'Offer installment financing for high-value services and packages.', 'Connect Affirm payments', paymentFields.bnpl, ['installments', 'financing'], [], { region: 'US/Canada', paymentModes: ['Installments'] }),
      card('tap-payment', 'payments-global', 'Tap Payment', 'TAP', '#111827', 'Accept GCC cards, wallets and local payment methods through Tap.', 'Connect Tap payment gateway', paymentFields.merchant, ['payments', 'gcc'], [], { region: 'GCC', paymentModes: ['Cards', 'Wallets'] }),
      card('tabby-payment', 'payments-global', 'Tabby Payment', 'TBY', '#00e19f', 'Enable buy-now-pay-later payments through Tabby.', 'Connect Tabby payment gateway', paymentFields.merchant, ['bnpl', 'gcc'], [], { region: 'GCC', paymentModes: ['BNPL'] }),
      card('tamara-payment', 'payments-global', 'Tamara Payment', 'TMR', '#e879f9', 'Enable Tamara installments for checkout.', 'Connect Tamara payment gateway', paymentFields.merchant, ['bnpl', 'gcc'], [], { region: 'GCC', paymentModes: ['Installments'] }),
      card('pix', 'payments-global', 'Pix', 'PIX', '#22c55e', 'Accept instant Brazilian Pix payments.', 'Connect Pix payments', paymentFields.localMethod, ['instant-payments', 'brazil'], [], { region: 'Brazil', paymentModes: ['Instant bank'] }),
      card('boleto', 'payments-global', 'Boleto', 'BOL', '#f59e0b', 'Accept Brazilian boleto cash voucher payments.', 'Connect Boleto payments', paymentFields.localMethod, ['voucher', 'brazil'], [], { region: 'Brazil', paymentModes: ['Voucher'] }),
      card('oxxo', 'payments-global', 'OXXO', 'OXXO', '#e11d48', 'Accept Mexico cash voucher payments through OXXO.', 'Connect OXXO payments', paymentFields.localMethod, ['voucher', 'mexico'], [], { region: 'Mexico', paymentModes: ['Cash voucher'] }),
      card('spei', 'payments-global', 'SPEI', 'SPEI', '#4B1238', 'Accept Mexican bank transfer payments through SPEI.', 'Connect SPEI payments', paymentFields.localMethod, ['bank-transfer', 'mexico'], [], { region: 'Mexico', paymentModes: ['Bank transfer'] }),
      card('konbini', 'payments-global', 'Konbini', 'KON', '#f97316', 'Accept Japanese convenience store payments.', 'Connect Konbini payments', paymentFields.localMethod, ['cash-voucher', 'japan'], [], { region: 'Japan', paymentModes: ['Convenience store'] }),
      card('paynow', 'payments-global', 'PayNow', 'PN', '#7c3aed', 'Accept Singapore PayNow QR and bank payments.', 'Connect PayNow payments', paymentFields.localMethod, ['qr', 'singapore'], [], { region: 'Singapore', paymentModes: ['QR', 'Bank'] }),
      card('grabpay', 'payments-global', 'GrabPay', 'GP', '#00b14f', 'Accept GrabPay wallet payments across supported Southeast Asia markets.', 'Connect GrabPay wallet', paymentFields.localMethod, ['wallets', 'southeast-asia'], [], { region: 'SEA', paymentModes: ['Wallet'] }),
      card('fpx', 'payments-global', 'FPX', 'FPX', '#2563eb', 'Accept Malaysia online banking payments through FPX.', 'Connect FPX payments', paymentFields.localMethod, ['bank-redirect', 'malaysia'], [], { region: 'Malaysia', paymentModes: ['Online banking'] }),
      card('duitnow', 'payments-global', 'DuitNow', 'DN', '#9333ea', 'Accept Malaysia DuitNow QR and instant transfers.', 'Connect DuitNow payments', paymentFields.localMethod, ['qr', 'instant-payments', 'malaysia'], [], { region: 'Malaysia', paymentModes: ['QR', 'Instant'] }),
      card('promptpay', 'payments-global', 'PromptPay', 'PPay', '#155e75', 'Accept Thailand PromptPay QR transfers.', 'Connect PromptPay payments', paymentFields.localMethod, ['qr', 'thailand'], [], { region: 'Thailand', paymentModes: ['QR'] }),
      card('alipay', 'payments-global', 'Alipay', 'ALI', '#1677ff', 'Accept Alipay wallet payments from Chinese customers.', 'Connect Alipay payments', paymentFields.localMethod, ['wallets', 'china'], [], { region: 'China/Global', paymentModes: ['Wallet'] }),
      card('wechat-pay', 'payments-global', 'WeChat Pay', 'WCP', '#07c160', 'Accept WeChat Pay wallet and QR payments.', 'Connect WeChat Pay', paymentFields.localMethod, ['wallets', 'qr', 'china'], [], { region: 'China/Global', paymentModes: ['Wallet', 'QR'] }),
      card('unionpay', 'payments-global', 'UnionPay', 'UPay', '#e11d48', 'Accept UnionPay cards for international customers.', 'Connect UnionPay cards', paymentFields.localMethod, ['cards', 'china'], [], { region: 'China/Global', paymentModes: ['Cards'] }),
      card('gocardless', 'payments-global', 'GoCardless', 'GC', '#111827', 'Collect recurring bank debit payments using GoCardless.', 'Connect GoCardless', paymentFields.directDebit, ['bank-debit', 'recurring'], [], { region: 'Global', paymentModes: ['Bank debit'] }),
      card('airwallex', 'payments-global', 'Airwallex', 'AWX', '#612fff', 'Accept global payments, FX settlement and multi-currency collections.', 'Connect Airwallex payments', paymentFields.globalGateway, ['multi-currency', 'fx', 'cards'], [], { region: 'Global', paymentModes: ['Multi-currency', 'FX'] }),
      card('wise-business', 'payments-global', 'Wise Business', 'WISE', '#9fe870', 'Collect and settle international bank transfers with Wise Business.', 'Connect Wise Business', paymentFields.bankTransfer, ['bank-transfer', 'multi-currency'], [], { region: 'Global', paymentModes: ['Bank transfer', 'FX'] }),
      card('revolut-pay', 'payments-global', 'Revolut Pay', 'REV', '#111827', 'Accept Revolut Pay wallet and card checkout.', 'Connect Revolut Pay', paymentFields.localMethod, ['wallets', 'cards'], [], { region: 'UK/Europe', paymentModes: ['Wallet', 'Cards'] })
    ]
  },
  {
    key: 'notifications',
    title: 'Emails & SMS Notifications',
    integrations: [
      card('mailchimp', 'notifications', 'MailChimp', 'MC', '#f7c948', 'Use MailChimp for marketing journeys and newsletters.', 'Connect MailChimp campaigns', notificationFields.email, ['email', 'campaigns']),
      card('sms-api', 'notifications', 'Sms Api Integration', 'SMS', '#2563eb', 'Send SMS confirmations, reminders and review requests.', 'Connect SMS gateway', notificationFields.sms, ['sms', 'templates']),
      card('whatsapp-cloud', 'notifications', 'WhatsApp Integration', 'WA', '#16a34a', 'Enable WhatsApp booking, reminders and review requests.', 'Connect WhatsApp Cloud API', notificationFields.whatsapp, ['whatsapp', 'templates', 'webhooks']),
      card('getresponse', 'notifications', 'Get Response', 'GR', '#0ea5e9', 'Send email newsletters for bookings and marketing.', 'Connect GetResponse email', notificationFields.email, ['email', 'campaigns']),
      card('smtp-setting', 'notifications', 'SMTP Setting', 'SMTP', '#60a5fa', 'Send transactional email using your SMTP server.', 'Configure SMTP mail server', notificationFields.smtp, ['email', 'transactional']),
      card('twilio-whatsapp', 'notifications', 'Twilio WhatsApp Integration', 'TW', '#ef4444', 'Send WhatsApp notifications using Twilio.', 'Connect Twilio WhatsApp', notificationFields.whatsappApi, ['whatsapp', 'sms']),
      card('interakt-api', 'notifications', 'Interakt API Integration', 'INT', '#00a884', 'Run WhatsApp commerce and campaigns using Interakt.', 'Connect Interakt API', notificationFields.whatsappApi, ['whatsapp']),
      card('zoko-api', 'notifications', 'Zoko API Integration', 'ZOKO', '#111827', 'Connect Zoko for WhatsApp conversations and broadcasts.', 'Connect Zoko API', notificationFields.whatsappApi, ['whatsapp']),
      card('botat-api', 'notifications', 'Botat API Integration', 'BOT', '#111827', 'Connect Botat for WhatsApp automation.', 'Connect Botat API', notificationFields.whatsappApi, ['whatsapp']),
      card('aisensy-api', 'notifications', 'Aisensy API Integration', 'AIS', '#16a34a', 'Connect AiSensy campaigns and WhatsApp templates.', 'Connect AiSensy API', notificationFields.whatsappApi, ['whatsapp', 'campaigns'])
    ]
  },
  {
    key: 'accounting',
    title: 'Accounting Managements',
    integrations: [
      card('quickbooks', 'accounting', 'QuickBooks', 'QB', '#2ca01c', 'Generate invoices and billing records in QuickBooks.', 'Connect QuickBooks accounting', [
        accountField,
        modeField,
        { key: 'clientId', label: 'Client ID', placeholder: 'QuickBooks app client ID', sensitive: true, required: true },
        { key: 'clientSecret', label: 'Client Secret', placeholder: 'QuickBooks app secret', type: 'password', sensitive: true, required: true },
        { key: 'realmId', label: 'Realm ID', placeholder: 'Company realm ID' }
      ], ['accounting', 'invoices', 'customers']),
      card('qoyod', 'accounting', 'Qoyod', 'QYD', '#1e3a8a', 'Generate invoices and billing records in Qoyod.', 'Connect Qoyod accounting', [
        accountField,
        { key: 'apiKey', label: 'API Key', placeholder: 'Qoyod API key', type: 'password', sensitive: true, required: true },
        { key: 'organizationId', label: 'Organization ID', placeholder: 'Qoyod organization ID' }
      ], ['accounting', 'invoices'])
    ]
  },
  {
    key: 'booking',
    title: 'Booking Integrations',
    integrations: [
      card('booking-widget', 'booking', 'Booking Widget', 'BOOK', '#16a34a', 'Generate embed code for creating a booking widget.', 'Create booking widget embed', [
        accountField,
        { key: 'widgetSlug', label: 'Widget slug', placeholder: 'aurashine-hyd', required: true },
        { key: 'defaultBranchId', label: 'Default branch ID', placeholder: 'branch_hyd' },
        { key: 'themeColor', label: 'Theme color', placeholder: '#0f8f79' }
      ], ['booking-widget'], [{ label: 'Embed code', kind: 'embed' }]),
      card('weebly', 'booking', 'Weebly', 'W', '#2991ff', 'Get embed code for creating bookings on Weebly.', 'Install booking widget on Weebly', [
        accountField,
        { key: 'siteUrl', label: 'Website URL', placeholder: 'https://salon.weebly.com', type: 'url', required: true },
        { key: 'embedDomain', label: 'Allowed embed domain', placeholder: 'salon.weebly.com' }
      ], ['booking-widget'], [{ label: 'Embed code', kind: 'embed' }]),
      card('wix', 'booking', 'Wix', 'WIX', '#0ea5e9', 'Get embed code for creating bookings on Wix.', 'Install booking widget on Wix', [
        accountField,
        { key: 'siteUrl', label: 'Wix website URL', placeholder: 'https://example.wixsite.com/salon', type: 'url', required: true },
        { key: 'wixSiteId', label: 'Wix Site ID', placeholder: 'Optional site ID' }
      ], ['booking-widget'], [{ label: 'Embed code', kind: 'embed' }]),
      card('wordpress', 'booking', 'WordPress', 'WP', '#00749c', 'Get embed code for creating bookings on WordPress.', 'Install booking widget on WordPress', [
        accountField,
        { key: 'siteUrl', label: 'WordPress URL', placeholder: 'https://salon.com', type: 'url', required: true },
        { key: 'restKey', label: 'REST API Key', placeholder: 'Optional WordPress REST key', type: 'password', sensitive: true }
      ], ['booking-widget'], [{ label: 'Embed code', kind: 'embed' }]),
      card('lead-widget', 'booking', 'Lead Widget', 'LEAD', '#f97316', 'Capture website leads into Aura CRM.', 'Create lead widget embed', [
        accountField,
        { key: 'leadSource', label: 'Lead source', placeholder: 'Website lead widget', required: true },
        { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Lead webhook secret', type: 'password', sensitive: true }
      ], ['lead-capture'], [{ label: 'Lead webhook', kind: 'webhook' }]),
      card('woocommerce', 'booking', 'Woocommerce', 'WOO', '#7f54b3', 'Let customers purchase products directly from your website.', 'Connect WooCommerce store', [
        accountField,
        { key: 'storeUrl', label: 'Store URL', placeholder: 'https://store.com', type: 'url', required: true },
        { key: 'consumerKey', label: 'Consumer Key', placeholder: 'ck_xxxxx', sensitive: true, required: true },
        { key: 'consumerSecret', label: 'Consumer Secret', placeholder: 'cs_xxxxx', type: 'password', sensitive: true, required: true }
      ], ['products', 'orders', 'webhooks']),
      card('shopify', 'booking', 'Shopify', 'SHOP', '#95bf47', 'Synchronise products and orders from salon to store.', 'Connect Shopify store', [
        accountField,
        { key: 'shopDomain', label: 'Shop domain', placeholder: 'aurashine.myshopify.com', required: true },
        { key: 'accessToken', label: 'Admin API Access Token', placeholder: 'shpat_xxxxx', type: 'password', sensitive: true, required: true },
        { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'Shopify webhook secret', type: 'password', sensitive: true }
      ], ['products', 'orders', 'webhooks'])
    ]
  },
  {
    key: 'other',
    title: 'Other Integrations',
    integrations: [
      card('google-reservation', 'other', 'Google Reservation', 'GRSV', '#4285f4', 'Use Google Reserve to book appointments online.', 'Connect Google Reserve', [
        accountField,
        { key: 'partnerId', label: 'Partner ID', placeholder: 'Google Reserve partner ID', required: true },
        { key: 'feedsBucket', label: 'Feeds bucket', placeholder: 'Google feed storage path' },
        { key: 'serviceAccountJson', label: 'Service Account JSON', placeholder: 'Paste service account JSON', type: 'textarea', sensitive: true, required: true }
      ], ['bookings', 'reserve']),
      card('google-analytics', 'other', 'Google Analytics', 'GA4', '#f9ab00', 'Track events, goals and booking conversion.', 'Connect Google Analytics', [
        accountField,
        { key: 'measurementId', label: 'Measurement ID', placeholder: 'G-XXXXXXXXXX', required: true },
        { key: 'apiSecret', label: 'Measurement API Secret', placeholder: 'GA4 API secret', type: 'password', sensitive: true }
      ], ['analytics', 'events']),
      card('facebook-tiktok-pixel', 'other', 'Facebook and Tiktok Pixel', 'PIX', '#1877f2', 'Track advertising conversions from Meta and TikTok.', 'Connect ad pixels', [
        accountField,
        { key: 'metaPixelId', label: 'Meta Pixel ID', placeholder: 'Facebook pixel ID' },
        { key: 'metaAccessToken', label: 'Meta Access Token', placeholder: 'Conversions API token', type: 'password', sensitive: true },
        { key: 'tiktokPixelId', label: 'TikTok Pixel ID', placeholder: 'TikTok pixel ID' },
        { key: 'tiktokAccessToken', label: 'TikTok Access Token', placeholder: 'Events API token', type: 'password', sensitive: true }
      ], ['ads', 'analytics']),
      card('google-calendar', 'other', 'Google Calendar integration', 'GCal', '#4285f4', 'Manage user appointments on calendar.', 'Connect Google Calendar', [
        accountField,
        { key: 'calendarId', label: 'Calendar ID', placeholder: 'primary or branch calendar ID', required: true },
        { key: 'clientId', label: 'OAuth Client ID', placeholder: 'Google OAuth client ID', sensitive: true, required: true },
        { key: 'clientSecret', label: 'OAuth Client Secret', placeholder: 'Google OAuth secret', type: 'password', sensitive: true, required: true }
      ], ['calendar.events', 'calendar.readonly'], [{ label: 'OAuth redirect URI', kind: 'redirect' }]),
      card('data-migration', 'other', 'Migrate Your Data', 'MIG', '#111827', 'Migrate appointments from Booksy, Fresha, Vagaro or CSV.', 'Import appointment data', [
        accountField,
        { key: 'sourceSystem', label: 'Source system', placeholder: 'Booksy, Fresha, Vagaro, CSV', required: true },
        { key: 'importToken', label: 'Import Token', placeholder: 'Secure import token', type: 'password', sensitive: true },
        { key: 'importNotes', label: 'Import notes', placeholder: 'Data range, branches, fields', type: 'textarea' }
      ], ['migration', 'appointments'])
    ]
  }
];

@Component({
  selector: 'app-marketplace-integrations',
  standalone: true,
  imports: [CommonModule, FormsModule, StateComponent],
  template: `
    <section class="integrations-page">
      <header class="integrations-header">
        <div>
          <h2>Integrations</h2>
        </div>
        <div class="header-actions">
          <label class="search-box">
            <span>Search</span>
            <input [(ngModel)]="query" placeholder="Search integrations" />
          </label>
          <button class="ghost-button" type="button" (click)="load()" [disabled]="loading">Refresh</button>
        </div>
      </header>

      <div class="market-summary">
        <div>
          <strong>{{ totalIntegrations }}</strong>
          <span>Total integrations</span>
        </div>
        <div>
          <strong>{{ paymentIntegrationCount }}</strong>
          <span>Payment modes</span>
        </div>
        <div>
          <strong>{{ connectedCount }}</strong>
          <span>Connected</span>
        </div>
        <div>
          <strong>{{ activeCategoryLabel }}</strong>
          <span>Current view</span>
        </div>
      </div>

      <nav class="category-tabs" aria-label="Integration categories">
        <button type="button" [class.active]="activeCategory === 'all'" (click)="setCategory('all')">
          All <span>{{ totalIntegrations }}</span>
        </button>
        <button type="button" *ngFor="let category of catalog" [class.active]="activeCategory === category.key" (click)="setCategory(category.key)">
          {{ category.title }} <span>{{ category.integrations.length }}</span>
        </button>
      </nav>

      <app-state [loading]="loading" [error]="error"></app-state>

      <ng-container *ngIf="!loading && !error">
        <ng-container *ngIf="filteredCatalog.length; else noIntegrationResults">
          <section class="category-panel" *ngFor="let category of filteredCatalog">
            <div class="category-title">
              <div>
                <strong>{{ category.title }}</strong>
                <span>{{ category.integrations.length }} available integrations</span>
              </div>
            </div>
            <div class="integration-grid">
              <button class="integration-card" type="button" *ngFor="let integration of category.integrations" (click)="open(integration)" [class.connected]="connectionFor(integration)" [class.featured]="integration.featured">
                <span class="status-dot" [class.on]="connectionFor(integration)"></span>
                <span class="region-chip" *ngIf="integration.region">{{ integration.region }}</span>
                <span class="logo-ring" [style.--accent]="integration.accent">
                  <span>{{ integration.logo }}</span>
                </span>
                <strong>{{ integration.name }}</strong>
                <small>{{ integration.description }}</small>
                <span class="mode-tags" *ngIf="integration.paymentModes?.length">
                  <span *ngFor="let mode of integration.paymentModes?.slice(0, 3)">{{ mode }}</span>
                </span>
                <span class="connect-text">{{ connectionFor(integration) ? 'Manage setup' : 'Configure' }}</span>
              </button>
            </div>
          </section>
        </ng-container>
        <ng-template #noIntegrationResults>
          <div class="empty-market">
            <strong>No integrations found</strong>
            <span>Try another provider, country, payment mode or category.</span>
          </div>
        </ng-template>
      </ng-container>

      <div class="drawer-backdrop" *ngIf="selected" (click)="close()"></div>
      <aside class="setup-drawer" *ngIf="selected as active">
        <div class="drawer-heading">
          <button class="close-button" type="button" (click)="close()" aria-label="Close">x</button>
          <div>
            <span class="eyebrow">{{ categoryLabel(active.category) }}</span>
            <h3>{{ active.name }}</h3>
          </div>
          <span class="connection-pill" [class.connected]="connectionFor(active)">{{ connectionFor(active) ? 'Connected' : 'Not connected' }}</span>
        </div>

        <div class="drawer-content">
          <form class="setup-form" (ngSubmit)="save(active)">
            <label class="field" *ngFor="let field of active.fields">
              <span>{{ field.label }}</span>
              <select *ngIf="field.type === 'select'; else nonSelect" [(ngModel)]="formValues[field.key]" [name]="field.key" [required]="field.required === true">
                <option value="" disabled>{{ field.placeholder }}</option>
                <option *ngFor="let option of field.options || []" [value]="option">{{ option }}</option>
              </select>
              <ng-template #nonSelect>
                <textarea *ngIf="field.type === 'textarea'; else scalarInput" [(ngModel)]="formValues[field.key]" [name]="field.key" [placeholder]="field.placeholder" [required]="field.required === true"></textarea>
                <ng-template #scalarInput>
                  <input [type]="field.type || 'text'" [(ngModel)]="formValues[field.key]" [name]="field.key" [placeholder]="field.placeholder" [required]="field.required === true" />
                </ng-template>
              </ng-template>
              <small *ngIf="field.sensitive">Stored through encrypted secret vault.</small>
            </label>

            <div class="generated-box" *ngIf="active.outputs?.length">
              <div class="generated-row" *ngFor="let output of active.outputs">
                <span>{{ output.label }}</span>
                <code>{{ outputValue(active, output) }}</code>
                <button class="ghost-button slim" type="button" (click)="copy(outputValue(active, output))">Copy</button>
              </div>
            </div>

            <p class="save-message" *ngIf="saveMessage">{{ saveMessage }}</p>
            <p class="field-error" *ngIf="formError">{{ formError }}</p>

            <div class="drawer-actions">
              <button class="ghost-button" type="button" (click)="disconnect(active)" [disabled]="saving || !connectionFor(active)">Disable</button>
              <button class="primary-button" type="submit" [disabled]="saving">{{ saving ? 'Saving' : 'Save' }}</button>
            </div>
          </form>

          <section class="setup-guide">
            <div class="guide-logo" [style.--accent]="active.accent">{{ active.logo }}</div>
            <h3>{{ active.setupTitle }}</h3>
            <p>{{ active.setupBody }}</p>
            <div class="drawer-mode-list" *ngIf="active.paymentModes?.length">
              <span *ngFor="let mode of active.paymentModes">{{ mode }}</span>
            </div>
            <div class="guide-rule"></div>
            <strong>Steps:</strong>
            <ol>
              <li *ngFor="let step of active.steps">{{ step }}</li>
            </ol>
            <div class="scope-list">
              <span *ngFor="let scope of active.scopes">{{ scope }}</span>
            </div>
          </section>
        </div>
      </aside>
    </section>
  `,
  styles: [`
    .integrations-page { padding: 18px 22px 40px; background: #f5f7fb; min-height: calc(100vh - 80px); color: #0f172a; }
    .integrations-header { display: flex; justify-content: space-between; gap: 18px; align-items: flex-end; margin-bottom: 18px; }
    .integrations-header h2 { margin: 4px 0 6px; color: #0f172a; font-size: 34px; letter-spacing: 0; }
    .integrations-header p { margin: 0; color: #53657d; max-width: 780px; line-height: 1.5; }
    .eyebrow { text-transform: uppercase; font-size: 12px; font-weight: 900; color: #64748b; letter-spacing: 0; }
    .header-actions { display: flex; align-items: flex-end; gap: 12px; }
    .search-box { display: grid; gap: 6px; color: #334155; font-size: 12px; font-weight: 800; }
    .search-box input { width: 280px; border: 1px solid #d7dee8; border-radius: 8px; padding: 11px 12px; font: inherit; background: #fff; box-shadow: 0 1px 0 rgba(15, 23, 42, .03); }
    .market-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 14px; }
    .market-summary div { background: #fff; border: 1px solid #dde5ef; border-radius: 8px; padding: 14px 16px; box-shadow: 0 12px 26px rgba(15, 23, 42, .04); }
    .market-summary strong { display: block; color: #0f172a; font-size: 24px; line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .market-summary span { display: block; margin-top: 4px; color: #64748b; font-weight: 800; font-size: 12px; }
    .category-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 2px 0 14px; margin-bottom: 4px; }
    .category-tabs button { border: 1px solid #d7dee8; background: #fff; color: #334155; border-radius: 999px; padding: 9px 12px; font-weight: 900; cursor: pointer; white-space: nowrap; }
    .category-tabs button.active { background: #0f8f79; border-color: #0f8f79; color: #fff; }
    .category-tabs span { margin-left: 6px; opacity: .75; }
    .category-panel { background: #fff; border: 1px solid #d8dde5; border-radius: 8px; padding: 10px 14px 24px; margin-bottom: 20px; box-shadow: 0 14px 30px rgba(15, 23, 42, .04); }
    .category-title { background: #eef2f6; border-radius: 7px; padding: 12px 14px; color: #020617; margin-bottom: 18px; }
    .category-title strong { display: block; font-size: 20px; font-weight: 900; }
    .category-title span { display: block; color: #64748b; font-size: 12px; font-weight: 800; margin-top: 3px; }
    .integration-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(174px, 1fr)); gap: 14px; }
    .integration-card { position: relative; min-height: 236px; border: 1px solid #edf1f5; background: #fff; border-radius: 8px; padding: 16px 12px 14px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 10px; cursor: pointer; box-shadow: 0 12px 24px rgba(15, 23, 42, .055); transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease, background .18s ease; text-align: center; }
    .integration-card:hover { transform: translateY(-2px); border-color: #b8c4d3; box-shadow: 0 18px 36px rgba(15, 23, 42, .12); }
    .integration-card.connected { border-color: #0f8f79; background: #fbfffd; }
    .integration-card.featured { border-color: rgba(15, 143, 121, .35); }
    .status-dot { position: absolute; top: 12px; right: 12px; width: 10px; height: 10px; border-radius: 999px; background: #cbd5e1; }
    .status-dot.on { background: #0f8f79; box-shadow: 0 0 0 4px rgba(15, 143, 121, .12); }
    .region-chip { position: absolute; top: 9px; left: 10px; border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; border-radius: 999px; padding: 4px 7px; font-size: 10px; font-weight: 900; max-width: 94px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .logo-ring { --accent: #0f8f79; width: 86px; height: 86px; border-radius: 999px; display: grid; place-items: center; background: #fff; border: 2px solid #f1f5f9; box-shadow: inset 0 0 0 4px #fff, 0 2px 9px rgba(15, 23, 42, .14); margin-top: 8px; }
    .logo-ring span { width: 58px; min-width: 0; height: 40px; border-radius: 8px; display: grid; place-items: center; color: var(--accent); font-weight: 950; font-size: 16px; line-height: 1; overflow-wrap: anywhere; }
    .integration-card strong { color: #020617; font-size: 16px; }
    .integration-card small { color: #475569; line-height: 1.25; max-width: 170px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .mode-tags { display: flex; flex-wrap: wrap; justify-content: center; gap: 5px; min-height: 24px; }
    .mode-tags span { border-radius: 999px; background: #eef2f7; color: #334155; padding: 4px 7px; font-size: 10px; font-weight: 900; }
    .connect-text { margin-top: auto; color: #0f8f79; font-size: 12px; font-weight: 950; }
    .empty-market { background: #fff; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 28px; color: #475569; display: grid; gap: 6px; }
    .empty-market strong { color: #0f172a; font-size: 18px; }
    .drawer-backdrop { position: fixed; inset: 0; background: rgba(2, 6, 23, .62); z-index: 30; }
    .setup-drawer { position: fixed; z-index: 31; inset: 0 0 0 auto; width: min(1140px, calc(100vw - 82px)); background: #fff; box-shadow: -18px 0 42px rgba(15, 23, 42, .22); display: flex; flex-direction: column; }
    .drawer-heading { display: flex; align-items: center; gap: 16px; padding: 22px 28px; border-bottom: 1px solid #edf2f7; }
    .drawer-heading h3 { margin: 2px 0 0; color: #333; font-size: 24px; letter-spacing: 0; }
    .close-button { border: 0; background: transparent; font-size: 34px; line-height: 1; cursor: pointer; color: #222; width: 32px; height: 32px; }
    .connection-pill { margin-left: auto; border-radius: 999px; padding: 7px 12px; background: #f1f5f9; color: #475569; font-size: 12px; font-weight: 900; }
    .connection-pill.connected { background: #e8f7f1; color: #047857; }
    .drawer-content { display: grid; grid-template-columns: minmax(360px, 1fr) 485px; gap: 60px; padding: 34px 48px; overflow: auto; }
    .setup-form { display: grid; align-content: start; gap: 14px; }
    .field { display: grid; gap: 7px; color: #444; font-weight: 800; }
    .field input, .field select, .field textarea { width: 100%; border: 1px solid #aeb7c3; border-radius: 7px; padding: 10px 11px; font: inherit; color: #111827; background: #fff; }
    .field textarea { min-height: 96px; resize: vertical; }
    .field small { color: #64748b; font-weight: 600; }
    .generated-box { border: 1px dashed #cbd5e1; border-radius: 8px; padding: 12px; background: #f8fafc; display: grid; gap: 10px; }
    .generated-row { display: grid; grid-template-columns: 120px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .generated-row code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 9px; color: #334155; }
    .drawer-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 2px; }
    .primary-button, .ghost-button { border: 1px solid #d7dee8; border-radius: 8px; padding: 10px 14px; font-weight: 900; cursor: pointer; }
    .primary-button { background: #111827; color: #fff; border-color: #111827; }
    .ghost-button { background: #fff; color: #0f172a; }
    .ghost-button.slim { padding: 7px 10px; font-size: 12px; }
    .primary-button:disabled, .ghost-button:disabled { opacity: .55; cursor: not-allowed; }
    .field-error { color: #dc2626; font-weight: 800; }
    .save-message { color: #047857; font-weight: 800; }
    .setup-guide { color: #444; padding-top: 4px; }
    .guide-logo { --accent: #0f8f79; width: 92px; height: 92px; border-radius: 999px; display: grid; place-items: center; color: var(--accent); border: 2px solid #eef2f7; font-weight: 950; margin-bottom: 18px; box-shadow: 0 2px 9px rgba(15, 23, 42, .14); }
    .setup-guide h3 { margin: 0 0 16px; font-size: 24px; color: #333; line-height: 1.25; letter-spacing: 0; }
    .setup-guide p { margin: 0; color: #666; line-height: 1.5; }
    .drawer-mode-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .drawer-mode-list span { border-radius: 999px; background: #edfdf8; color: #047857; padding: 7px 10px; font-weight: 900; font-size: 12px; }
    .guide-rule { border-top: 1px solid #e5e7eb; margin: 20px 0; }
    .setup-guide ol { margin: 12px 0 0; padding-left: 22px; color: #777; display: grid; gap: 10px; line-height: 1.4; }
    .setup-guide li::marker { color: #555; font-weight: 900; }
    .scope-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; }
    .scope-list span { background: #eef2f7; color: #334155; border-radius: 999px; padding: 7px 10px; font-size: 12px; font-weight: 900; }
    @media (max-width: 1280px) {
      .drawer-content { grid-template-columns: 1fr; gap: 28px; }
    }
    @media (max-width: 760px) {
      .integrations-page { padding: 14px; }
      .integrations-header, .header-actions { display: grid; align-items: stretch; }
      .market-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .search-box input { width: 100%; }
      .integration-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .integration-card { min-height: 228px; }
      .setup-drawer { width: 100vw; }
      .drawer-content { padding: 24px 18px; }
      .generated-row { grid-template-columns: 1fr; }
    }
  `]
})
export class MarketplaceIntegrationsComponent implements OnInit {
  readonly catalog = catalog;
  connections: MarketplaceConnection[] = [];
  selected: IntegrationCard | null = null;
  formValues: Record<string, string> = {};
  query = '';
  activeCategory = 'all';
  loading = true;
  saving = false;
  error = '';
  formError = '';
  saveMessage = '';

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  get totalIntegrations(): number {
    return this.catalog.reduce((total, category) => total + category.integrations.length, 0);
  }

  get paymentIntegrationCount(): number {
    return this.catalog
      .filter((category) => category.key.startsWith('payments'))
      .reduce((total, category) => total + category.integrations.length, 0);
  }

  get connectedCount(): number {
    return this.catalog
      .flatMap((category) => category.integrations)
      .filter((integration) => this.connectionFor(integration))
      .length;
  }

  get activeCategoryLabel(): string {
    if (this.activeCategory === 'all') return 'All';
    return this.categoryLabel(this.activeCategory);
  }

  get filteredCatalog(): IntegrationCategory[] {
    const term = this.query.trim().toLowerCase();
    const categories = this.activeCategory === 'all'
      ? this.catalog
      : this.catalog.filter((category) => category.key === this.activeCategory);
    if (!term) return categories;
    return categories
      .map((category) => ({
        ...category,
        integrations: category.integrations.filter((integration) => {
          return [
            integration.name,
            integration.description,
            integration.category,
            integration.region || '',
            ...(integration.paymentModes || []),
            ...integration.scopes
          ].join(' ').toLowerCase().includes(term);
        })
      }))
      .filter((category) => category.integrations.length);
  }

  setCategory(category: string): void {
    this.activeCategory = category;
  }

  load(): void {
    this.loading = true;
    this.error = '';
    this.api.list<MarketplaceConnection[]>('marketplaceConnections', { branchId: this.api.selectedBranchId() }).subscribe({
      next: (rows) => {
        this.connections = Array.isArray(rows) ? rows : [];
        this.loading = false;
      },
      error: (error) => {
        this.error = error?.error?.error || error?.message || 'Unable to load marketplace integrations';
        this.loading = false;
      }
    });
  }

  open(integration: IntegrationCard): void {
    this.selected = integration;
    this.formError = '';
    this.saveMessage = '';
    const connection = this.connectionFor(integration);
    const credentials = record(connection?.credentials);
    const fields = record(credentials['fields']);
    this.formValues = {};
    for (const field of integration.fields) {
      if (field.sensitive) {
        this.formValues[field.key] = '';
      } else if (field.key === 'accountName') {
        this.formValues[field.key] = connection?.accountName || fields[field.key] || '';
      } else {
        this.formValues[field.key] = String(fields[field.key] || (field.type === 'select' ? field.options?.[0] || '' : ''));
      }
    }
  }

  close(): void {
    this.selected = null;
    this.formValues = {};
    this.formError = '';
    this.saveMessage = '';
  }

  save(integration: IntegrationCard): void {
    this.formError = '';
    this.saveMessage = '';
    const missing = integration.fields.find((field) => field.required && !this.formValues[field.key]?.trim() && !this.hasStoredSecret(integration, field));
    if (missing) {
      this.formError = `${missing.label} is required`;
      return;
    }

    this.saving = true;
    const connection = this.connectionFor(integration);
    const branchId = this.api.selectedBranchId();
    const secretFields = integration.fields.filter((field) => field.sensitive && this.formValues[field.key]?.trim());
    const secretRequests = secretFields.map((field) => {
      return this.api.post<ApiRecord>('security/encrypt', {
        name: `${integration.name} ${field.label}`,
        value: this.formValues[field.key],
        purpose: `marketplace:${integration.key}:${field.key}`,
        branchId
      }).pipe(map((secret) => [field.key, secret['id']] as const));
    });

    (secretRequests.length ? forkJoin(secretRequests) : of([])).pipe(
      switchMap((secretRefs) => {
        const payload = this.payloadFor(integration, connection, secretRefs);
        return connection?.id
          ? this.api.update<MarketplaceConnection>('marketplaceConnections', connection.id, payload)
          : this.api.create<MarketplaceConnection>('marketplaceConnections', payload);
      }),
      catchError((error) => {
        this.formError = error?.error?.error || error?.message || 'Unable to save integration';
        return of(null);
      }),
      finalize(() => {
        this.saving = false;
      })
    ).subscribe((saved) => {
      if (!saved) return;
      this.saveMessage = `${integration.name} integration saved`;
      this.load();
    });
  }

  disconnect(integration: IntegrationCard): void {
    const connection = this.connectionFor(integration);
    if (!connection?.id) return;
    this.saving = true;
    this.api.update<MarketplaceConnection>('marketplaceConnections', connection.id, {
      status: 'disabled',
      health: { status: 'disabled', providerKey: integration.key, disabledAt: new Date().toISOString() }
    }).pipe(finalize(() => {
      this.saving = false;
    })).subscribe({
      next: () => {
        this.saveMessage = `${integration.name} disabled`;
        this.load();
      },
      error: (error) => {
        this.formError = error?.error?.error || error?.message || 'Unable to disable integration';
      }
    });
  }

  connectionFor(integration: IntegrationCard): MarketplaceConnection | null {
    return this.connections.find((connection) => {
      const credentials = record(connection.credentials);
      return String(credentials['providerKey'] || '').toLowerCase() === integration.key || normalize(connection.provider) === normalize(integration.name);
    }) || null;
  }

  hasStoredSecret(integration: IntegrationCard, field: IntegrationField): boolean {
    const connection = this.connectionFor(integration);
    const vaultRefs = record(record(connection?.credentials)['vaultRefs']);
    return Boolean(field.sensitive && vaultRefs[field.key]);
  }

  payloadFor(integration: IntegrationCard, connection: MarketplaceConnection | null, secretRefs: Array<readonly [string, unknown]>): ApiRecord {
    const existingCredentials = record(connection?.credentials);
    const vaultRefs = { ...record(existingCredentials['vaultRefs']) };
    for (const [key, id] of secretRefs) {
      if (id) vaultRefs[key] = id;
    }
    const fields: ApiRecord = {};
    for (const field of integration.fields) {
      if (field.sensitive) continue;
      fields[field.key] = this.formValues[field.key] || '';
    }
    return {
      provider: integration.name,
      accountName: this.formValues['accountName'] || connection?.accountName || integration.name,
      branchId: this.api.selectedBranchId(),
      credentials: {
        providerKey: integration.key,
        category: integration.category,
        fields,
        vaultRefs,
        configuredSecrets: Object.keys(vaultRefs)
      },
      scopes: integration.scopes,
      health: {
        status: 'configured',
        providerKey: integration.key,
        configuredAt: new Date().toISOString(),
        outputTypes: integration.outputs?.map((output) => output.kind) || []
      },
      status: 'connected',
      lastSyncAt: connection?.lastSyncAt || ''
    };
  }

  outputValue(integration: IntegrationCard, output: SetupOutput): string {
    const slug = this.formValues['widgetSlug'] || this.formValues['leadSource'] || integration.key;
    const branchId = this.api.selectedBranchId() || 'branch';
    if (output.kind === 'embed') {
      return `<script src="https://app.aurashine.com/widget.js" data-tenant="aura" data-branch="${branchId}" data-widget="${slug}"></script>`;
    }
    if (output.kind === 'webhook') {
      return `https://api.aurashine.com/api/webhooks/${integration.key}/${branchId}`;
    }
    if (output.kind === 'redirect') {
      return `https://api.aurashine.com/api/oauth/${integration.key}/callback`;
    }
    return `https://api.aurashine.com/api/integrations/${integration.key}/callback`;
  }

  copy(value: string): void {
    navigator.clipboard?.writeText(value);
    this.saveMessage = 'Copied';
  }

  categoryLabel(key: string): string {
    return this.catalog.find((category) => category.key === key)?.title || 'Integration';
  }
}

function card(
  key: string,
  category: string,
  name: string,
  logo: string,
  accent: string,
  description: string,
  setupTitle: string,
  fields: IntegrationField[],
  scopes: string[],
  outputs: SetupOutput[] = [],
  meta: IntegrationCardMeta = {}
): IntegrationCard {
  return {
    key,
    category,
    name,
    logo,
    accent,
    ...meta,
    description,
    setupTitle,
    setupBody: description,
    fields,
    scopes,
    outputs,
    steps: [
      `Log in to your ${name} dashboard with the right business account.`,
      'Create or open the developer/API settings for the required mode.',
      'Copy the requested keys, IDs or webhook secrets into this setup panel.',
      'Save the integration and verify provider webhooks or OAuth callback URLs where applicable.'
    ]
  };
}

function record(value: unknown): ApiRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {};
}

function normalize(value = ''): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
