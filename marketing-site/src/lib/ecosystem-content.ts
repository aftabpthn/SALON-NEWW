export type EcosystemRole = "flow" | "owner" | "customer" | "staff";
export type EcosystemRoute = "platform" | "owner" | "customer" | "staff" | "workflows";

type RoleContent = {
  label: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  note: string;
};

type RouteSection = { title: string; body: string; items: string[]; note?: string };

type LocaleContent = {
  hero: { eyebrow: string; title: string; body: string; primary: string; secondary: string; disclosure: string; sceneLabel: string };
  ecosystem: { eyebrow: string; title: string; body: string; roles: Record<EcosystemRole, RoleContent> };
  workflow: { eyebrow: string; title: string; body: string; steps: Array<{ title: string; body: string; tag: string }>; note: string };
  chapters: { eyebrow: string; title: string; body: string; owner: RoleContent; customer: RoleContent; staff: RoleContent };
  tour: { eyebrow: string; title: string; body: string; disclosure: string; roles: Record<EcosystemRole, RoleContent> };
  route: Record<EcosystemRoute, { eyebrow: string; title: string; body: string; disclosure: string; sections: RouteSection[] }>;
  common: { explore: string; demo: string; qualification: string; productView: string; active: string };
};

export const ECOSYSTEM_CONTENT: Record<"en" | "hi", LocaleContent> = {
  en: {
    hero: {
      eyebrow: "The living salon operating system",
      title: "One salon day. Every role in context.",
      body: "Aura connects the owner’s CRM and POS, the customer booking journey, and the staff workday. A booking becomes a schedule, a bill, stock usage, staff attribution and a finance record without losing its branch context.",
      primary: "See Aura with your workflow",
      secondary: "Explore the platform",
      disclosure: "Illustrative ecosystem view based on confirmed Aura workflows. Not a live customer account.",
      sceneLabel: "Aura ecosystem",
    },
    ecosystem: {
      eyebrow: "Three working experiences",
      title: "Different screens. One operational record.",
      body: "Customers, staff and owners do not need the same interface. They do need the same booking and branch context.",
      roles: {
        flow: { label: "Complete flow", eyebrow: "Connected record", title: "Follow one booking through the business", body: "The customer’s choice reaches the appointment book, staff roster, checkout, stock and reporting as one traceable flow.", points: ["Pay-at-salon booking", "Branch and staff context", "GST-ready checkout", "Stock and attribution trail"], note: "Cross-branch sharing and settlement rules remain policy-dependent." },
        owner: { label: "Owner CRM", eyebrow: "Owner and front desk", title: "Run the floor and read the business", body: "Appointments, Customer 360, POS, staff, inventory and finance sit in one branch-aware operating view.", points: ["Calendar, queue and waitlist", "Customer history and preferences", "GST-ready billing and split payment", "Daily closing and branch comparison"], note: "GST records support reporting and review; Aura does not file GST returns for you." },
        customer: { label: "Customer App", eyebrow: "Customer journey", title: "Choose, book and return with less friction", body: "Customers can discover salons, choose a service and professional, book pay-at-salon appointments, manage visits and review their own records.", points: ["Discovery and salon profiles", "Book, cancel, reschedule and rebook", "Saved salons", "Read-only wallet, membership and invoice history"], note: "The confirmed booking flow is pay at salon. The app is not presented as fully offline, realtime, push-enabled or iOS-complete." },
        staff: { label: "Staff App", eyebrow: "Staff workday", title: "Give each person a clear day", body: "Staff can see their command centre, appointments, roster, tasks, attendance, leave, notifications and permitted performance context.", points: ["Daily command centre", "Roster and shift swaps", "Tasks, leave, notifications and chat", "Permission-gated targets and attribution"], note: "Secure attendance is Android-only and depends on owner policy. Selected actions may queue; this is not full offline operation." },
      },
    },
    workflow: {
      eyebrow: "Booking to revenue",
      title: "The handoffs are where Aura earns its place.",
      body: "A salon does not run in isolated modules. This is the operational chain Aura is designed to keep intact.",
      steps: [
        { tag: "Customer", title: "Discover and book", body: "The customer chooses a salon, service and professional, then places a pay-at-salon booking." },
        { tag: "CRM", title: "Create the appointment", body: "The branch calendar receives the service duration, professional preference and booking status." },
        { tag: "Staff", title: "Place it in the workday", body: "The appointment appears in the relevant schedule. Staff can see what is assigned without receiving unconfirmed Client 360 controls." },
        { tag: "Context", title: "Prepare with the right notes", body: "Authorised owner and front-desk views can use visit history, preferences and consultation context." },
        { tag: "POS", title: "Close the visit", body: "Services and retail items move into GST-ready billing with cash, card, UPI or wallet split payment." },
        { tag: "Stock", title: "Record consumption", body: "Product, batch, expiry and service-recipe context support usage and reorder review." },
        { tag: "Attribution", title: "Credit the work", body: "Service and product contribution can feed permission-gated staff commission and performance views." },
        { tag: "Owner", title: "See the operating result", body: "Closing, expenses, payments, journal context and branch-scoped reporting give the owner a usable view of the day." },
      ],
      note: "GST support means calculation, invoice records and reports, not direct filing. Compliance and cross-branch settlement execution remain partial.",
    },
    chapters: {
      eyebrow: "One ecosystem, three jobs",
      title: "Built around who is doing the work.",
      body: "Each experience stays focused while the underlying record remains connected.",
      owner: { label: "Owner CRM & POS", eyebrow: "Command centre", title: "Reception detail, owner-level context", body: "Run appointments, Customer 360, billing, staff policies, stock and finance without flattening every branch into one uncontrolled view.", points: ["Appointment calendar, waitlist and queue", "Customer history, loyalty, wallet and preferences", "GST-ready POS, refunds and split payments", "Inventory batches, service recipes and reorder context", "Attendance, commission, payroll and owner controls", "Daily closing, expenses and ledger trail"], note: "Multi-branch operations are branch-scoped. Comparison is supported; every cross-branch sharing or settlement policy is not claimed as complete." },
      customer: { label: "Customer App", eyebrow: "Book and come back", title: "A useful customer app, without inflated promises", body: "The current safe story is practical: find a salon, understand the profile, choose a service and professional, book pay-at-salon, and manage the visit later.", points: ["Marketplace discovery and salon profile", "Professional and service selection", "Pay-at-salon booking", "Cancel, reschedule and rebook", "Saved salons", "Read-only wallet, membership, invoice and payment history", "Consultation assistance when a provider is configured"], note: "Consultation assistance may use a configured provider with fallback behaviour. Aura does not present it as autonomous diagnosis or advice." },
      staff: { label: "Staff App", eyebrow: "A clearer shift", title: "What the team needs, with owner controls intact", body: "The Staff App covers the workday and personal employment context without exposing commercial information by default.", points: ["Staff login and daily command centre", "Appointments and roster", "Android secure attendance when policy enables it", "Shift swaps, tasks and selected queued actions", "Attendance, overtime and leave", "Permission-gated attribution, targets and performance", "Notifications, chat and owner controls"], note: "Secure attendance is Android-only. Appointment execution controls and full Client 360 actions are not marketed as confirmed Staff App capabilities." },
    },
    tour: {
      eyebrow: "Product stage", title: "Change roles without losing the day", body: "These handcrafted panels show confirmed product structure. Switch between the complete flow, owner, customer and staff views.", disclosure: "Illustrative product view · replace with approved product media",
      roles: {
        flow: { label: "Complete flow", eyebrow: "11:15 · Hair spa", title: "One visit, connected end to end", body: "Pay-at-salon booking → branch calendar → staff schedule → checkout → stock usage → attribution → closing.", points: ["Booking confirmed", "Professional assigned", "GST-ready bill prepared", "Usage and attribution recorded"], note: "Illustrative record, not live account data." },
        owner: { label: "Owner CRM", eyebrow: "Thursday · Jubilee Hills", title: "Today’s operating view", body: "The branch has 18 appointments, one waitlist request and a closing checklist in progress.", points: ["Calendar and queue", "Customer 360 context", "POS and payment record", "Stock and closing review"], note: "Branch-scoped view with authorised comparison." },
        customer: { label: "Customer App", eyebrow: "Upcoming visit", title: "Hair spa · Saturday, 4:00 PM", body: "The customer can review the salon and professional, then reschedule, cancel or rebook. Payment is due at the salon.", points: ["Salon profile", "Professional selected", "Pay at salon", "History is read-only"], note: "No online-payment, full-offline or iOS-complete claim." },
        staff: { label: "Staff App", eyebrow: "My day", title: "Six appointments · shift 10:00–19:00", body: "The team member sees assigned work, roster, tasks and allowed performance context.", points: ["Roster and appointments", "Task checklist", "Attendance policy", "Leave and notifications"], note: "Android secure attendance only when configured; selected actions may queue." },
      },
    },
    route: {
      platform: { eyebrow: "Aura platform", title: "A salon operating system with shared context", body: "Owner CRM, Customer App and Staff App are separate working experiences built around the same tenant, branch and booking record.", disclosure: "Capability map based on confirmed product workflows.", sections: [
        { title: "The operational core", body: "The owner workspace carries the full business context.", items: ["Appointments, queue and waitlist", "Customer 360 and consultation context", "POS, GST-ready invoices and split payments", "Staff, inventory, finance and branch-aware reports"] },
        { title: "The customer edge", body: "The customer journey starts before reception and continues after the visit.", items: ["Discovery and salon profiles", "Pay-at-salon booking", "Cancel, reschedule, rebook and save", "Read-only wallet, membership, invoice and payment history"], note: "Not presented as fully offline, realtime, push-enabled or iOS-complete." },
        { title: "The staff workday", body: "The staff experience keeps the day clear without bypassing owner permissions.", items: ["Command centre, appointments and roster", "Android attendance policy", "Tasks, swaps, leave, notifications and chat", "Permission-gated targets, performance and attribution"], note: "Selected actions may queue; full offline operation is not claimed." },
      ] },
      owner: { eyebrow: "Owner CRM & POS", title: "From reception pressure to owner clarity", body: "Aura keeps the operating details close to the transaction, the customer and the branch where they belong.", disclosure: "Illustrative product structure. Screenshots will be replaced with approved product media.", sections: [
        { title: "Front desk", body: "Keep the live day workable.", items: ["Appointment calendar and status", "Waitlist and queue context", "Service duration, chair and professional", "Customer notes and preferences"] },
        { title: "Checkout and stock", body: "Close the visit without breaking its trail.", items: ["Services and retail on one bill", "GST-ready invoice calculation", "Cash, card, UPI and wallet split payment", "Batch, expiry, service recipe and usage context"], note: "GST reports support review and preparation, not direct filing." },
        { title: "People and finance", body: "Connect the work to its operating result.", items: ["Attendance, shifts and commission policy", "Payroll exports and staff payouts", "Cash drawer, closing and expenses", "Source-linked journal and branch-scoped reporting"], note: "Compliance execution is partial and should be reviewed with the appropriate professional." },
      ] },
      customer: { eyebrow: "Customer App", title: "Booking that respects what is live today", body: "A straightforward customer journey for finding a salon, choosing the visit and keeping personal records close at hand.", disclosure: "Current capability story · pay at salon", sections: [
        { title: "Before the visit", body: "Make a considered booking.", items: ["Marketplace discovery", "Salon profile", "Service and professional selection", "Pay-at-salon booking", "Saved salons"] },
        { title: "Manage the booking", body: "Plans change. The booking should be manageable.", items: ["Cancellation", "Rescheduling", "Rebooking", "Upcoming and past visit context"] },
        { title: "Personal records", body: "Useful history without exposing owner controls.", items: ["Read-only wallet", "Read-only membership", "Invoice history", "Payment history", "Consultation assistance with provider disclosure"], note: "No claim of full offline, realtime, push or complete iOS support. Consultation assistance depends on configured-provider and fallback behaviour." },
      ] },
      staff: { eyebrow: "Staff App", title: "A workday app with clear permission boundaries", body: "Staff can see the day, manage personal work items and understand permitted performance context while owners retain policy control.", disclosure: "Current capability story · Android attendance qualification applies", sections: [
        { title: "Start the day", body: "Know the shift before the first client arrives.", items: ["Staff login", "Daily command centre", "Appointments", "Roster", "Tasks and notifications"] },
        { title: "Time and availability", body: "Keep attendance and leave records practical.", items: ["Android secure attendance when enabled", "Attendance and overtime", "Shift swaps", "Leave requests", "Selected queued actions"], note: "Secure attendance is Android-only and policy/configuration dependent. Queued actions do not mean full offline operation." },
        { title: "Work and communication", body: "Share enough commercial context to be useful, not uncontrolled.", items: ["Permission-gated service and product attribution", "Targets and performance", "Chat", "Owner controls"] , note: "Full Client 360 actions and appointment execution controls are not presented as confirmed Staff App capabilities." },
      ] },
      workflows: { eyebrow: "Connected workflows", title: "See where one action changes the next", body: "The value of the platform sits in its handoffs: customer to reception, reception to staff, checkout to stock, and closing to owner review.", disclosure: "Workflow map · confirmed capabilities and explicit qualifications", sections: [
        { title: "Booking to service", body: "Carry the original booking choice into the working day.", items: ["Customer discovery", "Pay-at-salon booking", "CRM appointment", "Staff schedule", "Authorised customer context"] },
        { title: "Service to revenue", body: "Close the visit and preserve its trail.", items: ["POS line items", "GST-ready calculation", "Split payment", "Inventory consumption", "Staff attribution"] },
        { title: "Revenue to review", body: "Give owners branch-aware context for the day.", items: ["Cash drawer and closing", "Expenses and refunds", "Journal context", "Branch-scoped reports and comparison"], note: "Direct GST filing, complete compliance execution and every cross-branch settlement policy are not claimed." },
      ] },
    },
    common: { explore: "Explore this experience", demo: "Discuss your workflow", qualification: "What to know", productView: "Illustrative product view", active: "Selected" },
  },
  hi: {
    hero: { eyebrow: "सैलून का जुड़ा हुआ ऑपरेटिंग सिस्टम", title: "एक सैलून दिवस। हर भूमिका सही संदर्भ में।", body: "Aura मालिक के CRM और POS, ग्राहक की बुकिंग और स्टाफ के कार्यदिवस को जोड़ता है। एक बुकिंग से शेड्यूल, बिल, स्टॉक उपयोग, स्टाफ attribution और फाइनेंस रिकॉर्ड बनते हैं, ब्रांच संदर्भ खोए बिना।", primary: "अपने वर्कफ़्लो के साथ Aura देखें", secondary: "प्लेटफ़ॉर्म देखें", disclosure: "पक्के Aura वर्कफ़्लो पर आधारित illustrative ecosystem view। यह लाइव ग्राहक अकाउंट नहीं है।", sceneLabel: "Aura ecosystem" },
    ecosystem: { eyebrow: "तीन कामकाजी अनुभव", title: "स्क्रीन अलग। ऑपरेशनल रिकॉर्ड एक।", body: "ग्राहक, स्टाफ और मालिक को एक जैसी स्क्रीन नहीं चाहिए। उन्हें एक ही बुकिंग और ब्रांच संदर्भ जरूर चाहिए।", roles: {
      flow: { label: "पूरा फ्लो", eyebrow: "जुड़ा रिकॉर्ड", title: "एक बुकिंग को पूरे बिज़नेस में देखें", body: "ग्राहक की पसंद अपॉइंटमेंट, स्टाफ रोस्टर, चेकआउट, स्टॉक और रिपोर्ट तक एक traceable flow में जाती है।", points: ["Pay-at-salon बुकिंग", "ब्रांच और स्टाफ संदर्भ", "GST-ready चेकआउट", "स्टॉक और attribution trail"], note: "Cross-branch sharing और settlement नियम policy पर निर्भर हैं।" },
      owner: { label: "Owner CRM", eyebrow: "मालिक और फ्रंट डेस्क", title: "फ्लोर चलाएँ, बिज़नेस समझें", body: "अपॉइंटमेंट, Customer 360, POS, स्टाफ, इन्वेंटरी और फाइनेंस एक branch-aware view में रहें।", points: ["कैलेंडर, queue और waitlist", "क्लाइंट हिस्ट्री और पसंद", "GST-ready बिलिंग और split payment", "डेली क्लोज़िंग और ब्रांच तुलना"], note: "GST रिकॉर्ड review और report में मदद करते हैं; Aura GST return file नहीं करता।" },
      customer: { label: "Customer App", eyebrow: "ग्राहक यात्रा", title: "चुनना, बुक करना और लौटना आसान", body: "ग्राहक सैलून ढूँढ सकते हैं, सर्विस और professional चुन सकते हैं, pay-at-salon booking संभाल सकते हैं और अपने रिकॉर्ड देख सकते हैं।", points: ["Discovery और salon profile", "Book, cancel, reschedule और rebook", "Saved salons", "Read-only wallet, membership और invoice history"], note: "पक्का booking flow pay at salon है। App को full offline, realtime, push-enabled या iOS-complete नहीं बताया गया है।" },
      staff: { label: "Staff App", eyebrow: "स्टाफ का दिन", title: "हर व्यक्ति को साफ़ कार्यदिवस", body: "स्टाफ command centre, appointments, roster, tasks, attendance, leave, notifications और अनुमति वाला performance context देख सकता है।", points: ["Daily command centre", "Roster और shift swaps", "Tasks, leave, notifications और chat", "Permission-gated targets और attribution"], note: "Secure attendance Android-only है और owner policy पर निर्भर है। कुछ actions queue हो सकते हैं; यह full offline operation नहीं है।" },
    } },
    workflow: { eyebrow: "Booking से revenue", title: "Aura की असली उपयोगिता handoff में दिखती है।", body: "सैलून अलग-अलग modules में नहीं चलता। Aura इस पूरी operational chain को जोड़े रखने के लिए बना है।", steps: [
      { tag: "Customer", title: "ढूँढें और बुक करें", body: "ग्राहक salon, service और professional चुनकर pay-at-salon booking करता है।" },
      { tag: "CRM", title: "अपॉइंटमेंट बनाएँ", body: "Branch calendar में duration, professional preference और booking status आता है।" },
      { tag: "Staff", title: "कार्यदिवस में रखें", body: "Appointment सही schedule में दिखता है। Staff को assigned काम दिखता है, unconfirmed Client 360 controls नहीं।" },
      { tag: "Context", title: "सही notes के साथ तैयारी", body: "Authorised owner और front-desk views history, preferences और consultation context देख सकते हैं।" },
      { tag: "POS", title: "विज़िट close करें", body: "Service और retail GST-ready bill में आते हैं, cash, card, UPI या wallet split payment के साथ।" },
      { tag: "Stock", title: "उपयोग दर्ज करें", body: "Product, batch, expiry और service recipe usage व reorder review में मदद करते हैं।" },
      { tag: "Attribution", title: "काम का credit रखें", body: "Service और product contribution permission-gated commission और performance views में जा सकता है।" },
      { tag: "Owner", title: "दिन का नतीजा देखें", body: "Closing, expense, payment, journal context और branch-scoped report मालिक को उपयोगी view देते हैं।" },
    ], note: "GST support का मतलब calculation, invoice record और report है, direct filing नहीं। Compliance और cross-branch settlement execution अभी partial हैं।" },
    chapters: { eyebrow: "एक ecosystem, तीन काम", title: "काम करने वाले व्यक्ति के अनुसार बना।", body: "हर experience केंद्रित रहता है, जबकि underlying record जुड़ा रहता है।",
      owner: { label: "Owner CRM और POS", eyebrow: "Command centre", title: "Reception की detail, मालिक का context", body: "Appointments, Customer 360, billing, staff policy, stock और finance संभालें, हर branch का scope बनाए रखते हुए।", points: ["Appointment calendar, waitlist और queue", "Customer history, loyalty, wallet और preferences", "GST-ready POS, refunds और split payment", "Inventory batches, service recipes और reorder context", "Attendance, commission, payroll और owner controls", "Daily closing, expense और ledger trail"], note: "Multi-branch operation branch-scoped है। तुलना उपलब्ध है; हर cross-branch sharing या settlement policy complete नहीं बताई गई है।" },
      customer: { label: "Customer App", eyebrow: "बुक करें और लौटें", title: "उपयोगी customer app, बिना बढ़े-चढ़े वादे", body: "मौजूदा कहानी सीधी है: salon ढूँढें, profile समझें, service और professional चुनें, pay-at-salon book करें और visit manage करें।", points: ["Marketplace discovery और salon profile", "Professional और service selection", "Pay-at-salon booking", "Cancel, reschedule और rebook", "Saved salons", "Read-only wallet, membership, invoice और payment history", "Provider configured होने पर consultation assistance"], note: "Consultation assistance configured provider और fallback इस्तेमाल कर सकती है। इसे diagnosis या autonomous advice नहीं बताया गया है।" },
      staff: { label: "Staff App", eyebrow: "साफ़ shift", title: "टीम को जरूरी जानकारी, owner control के साथ", body: "Staff App कार्यदिवस और personal employment context दिखाता है, commercial information default में expose किए बिना।", points: ["Staff login और daily command centre", "Appointments और roster", "Policy enabled होने पर Android secure attendance", "Shift swaps, tasks और selected queued actions", "Attendance, overtime और leave", "Permission-gated attribution, targets और performance", "Notifications, chat और owner controls"], note: "Secure attendance Android-only है। Appointment execution controls और full Client 360 actions को confirmed Staff App capability नहीं बताया गया है।" },
    },
    tour: { eyebrow: "Product stage", title: "भूमिका बदलें, दिन का संदर्भ नहीं", body: "ये handcrafted panels confirmed product structure दिखाते हैं। पूरा flow, owner, customer और staff view बदलकर देखें।", disclosure: "Illustrative product view · approved media से replace होगा", roles: {
      flow: { label: "पूरा फ्लो", eyebrow: "11:15 · Hair spa", title: "एक visit, शुरू से closing तक जुड़ी", body: "Pay-at-salon booking → branch calendar → staff schedule → checkout → stock usage → attribution → closing।", points: ["Booking confirmed", "Professional assigned", "GST-ready bill तैयार", "Usage और attribution दर्ज"], note: "Illustrative record, live account data नहीं।" },
      owner: { label: "Owner CRM", eyebrow: "गुरुवार · Jubilee Hills", title: "आज का operating view", body: "Branch में 18 appointments, एक waitlist request और closing checklist चल रही है।", points: ["Calendar और queue", "Customer 360 context", "POS और payment record", "Stock और closing review"], note: "Authorised comparison वाला branch-scoped view।" },
      customer: { label: "Customer App", eyebrow: "आने वाली visit", title: "Hair spa · शनिवार, 4:00 PM", body: "ग्राहक salon और professional देख सकता है, फिर reschedule, cancel या rebook कर सकता है। Payment salon पर होगा।", points: ["Salon profile", "Professional चुना", "Pay at salon", "History read-only है"], note: "Online-payment, full-offline या iOS-complete claim नहीं।" },
      staff: { label: "Staff App", eyebrow: "मेरा दिन", title: "छह appointments · shift 10:00–19:00", body: "Team member assigned work, roster, tasks और allowed performance context देखता है।", points: ["Roster और appointments", "Task checklist", "Attendance policy", "Leave और notifications"], note: "Configured होने पर Android secure attendance; कुछ actions queue हो सकते हैं।" },
    } },
    route: {
      platform: { eyebrow: "Aura platform", title: "Shared context वाला salon operating system", body: "Owner CRM, Customer App और Staff App अलग working experiences हैं, जो एक tenant, branch और booking record पर बने हैं।", disclosure: "Confirmed product workflows पर आधारित capability map।", sections: [
        { title: "Operational core", body: "Owner workspace पूरा business context रखता है।", items: ["Appointments, queue और waitlist", "Customer 360 और consultation context", "POS, GST-ready invoice और split payment", "Staff, inventory, finance और branch-aware reports"] },
        { title: "Customer edge", body: "Customer journey reception से पहले शुरू होती है और visit के बाद भी चलती है।", items: ["Discovery और salon profile", "Pay-at-salon booking", "Cancel, reschedule, rebook और save", "Read-only wallet, membership, invoice और payment history"], note: "इसे full offline, realtime, push-enabled या iOS-complete नहीं बताया गया है।" },
        { title: "Staff workday", body: "Staff experience owner permissions को bypass किए बिना दिन साफ़ रखता है।", items: ["Command centre, appointments और roster", "Android attendance policy", "Tasks, swaps, leave, notifications और chat", "Permission-gated targets, performance और attribution"], note: "कुछ actions queue हो सकते हैं; full offline operation claim नहीं है।" },
      ] },
      owner: { eyebrow: "Owner CRM और POS", title: "Reception pressure से owner clarity तक", body: "Aura operating details को transaction, customer और सही branch के साथ जोड़े रखता है।", disclosure: "Illustrative product structure। Approved product media मिलने पर screens replace होंगी।", sections: [
        { title: "Front desk", body: "Live day को workable रखें।", items: ["Appointment calendar और status", "Waitlist और queue context", "Service duration, chair और professional", "Customer notes और preferences"] },
        { title: "Checkout और stock", body: "Visit close करें, trail टूटने न दें।", items: ["Services और retail एक bill पर", "GST-ready invoice calculation", "Cash, card, UPI और wallet split payment", "Batch, expiry, service recipe और usage context"], note: "GST reports review और preparation में मदद करती हैं, direct filing नहीं।" },
        { title: "People और finance", body: "काम को operating result से जोड़ें।", items: ["Attendance, shifts और commission policy", "Payroll exports और staff payouts", "Cash drawer, closing और expenses", "Source-linked journal और branch-scoped reporting"], note: "Compliance execution partial है; सही professional के साथ review करें।" },
      ] },
      customer: { eyebrow: "Customer App", title: "वही booking story जो आज सच में live है", body: "Salon ढूँढने, visit चुनने और personal records पास रखने का सीधा customer journey।", disclosure: "Current capability story · pay at salon", sections: [
        { title: "Visit से पहले", body: "सोच-समझकर booking करें।", items: ["Marketplace discovery", "Salon profile", "Service और professional selection", "Pay-at-salon booking", "Saved salons"] },
        { title: "Booking संभालें", body: "Plan बदलें तो booking भी manage हो।", items: ["Cancellation", "Rescheduling", "Rebooking", "Upcoming और past visit context"] },
        { title: "Personal records", body: "Owner controls expose किए बिना उपयोगी history।", items: ["Read-only wallet", "Read-only membership", "Invoice history", "Payment history", "Provider disclosure के साथ consultation assistance"], note: "Full offline, realtime, push या complete iOS support claim नहीं। Consultation configured provider और fallback पर निर्भर है।" },
      ] },
      staff: { eyebrow: "Staff App", title: "Clear permission boundaries वाला workday app", body: "Staff दिन और personal work items देखता है; owner policy control बनाए रखता है।", disclosure: "Current capability story · Android attendance qualification लागू", sections: [
        { title: "दिन शुरू करें", body: "पहले client से पहले shift समझें।", items: ["Staff login", "Daily command centre", "Appointments", "Roster", "Tasks और notifications"] },
        { title: "Time और availability", body: "Attendance और leave record practical रखें।", items: ["Enabled होने पर Android secure attendance", "Attendance और overtime", "Shift swaps", "Leave requests", "Selected queued actions"], note: "Secure attendance Android-only और policy/configuration dependent है। Queued actions का मतलब full offline operation नहीं।" },
        { title: "Work और communication", body: "Useful commercial context दें, uncontrolled access नहीं।", items: ["Permission-gated service और product attribution", "Targets और performance", "Chat", "Owner controls"], note: "Full Client 360 actions और appointment execution controls को confirmed capability नहीं बताया गया है।" },
      ] },
      workflows: { eyebrow: "Connected workflows", title: "देखें एक action अगला काम कहाँ बदलता है", body: "Platform की value handoff में है: customer से reception, reception से staff, checkout से stock और closing से owner review।", disclosure: "Workflow map · confirmed capabilities और साफ़ qualifications", sections: [
        { title: "Booking से service", body: "Original booking choice को कार्यदिवस तक ले जाएँ।", items: ["Customer discovery", "Pay-at-salon booking", "CRM appointment", "Staff schedule", "Authorised customer context"] },
        { title: "Service से revenue", body: "Visit close करें और trail रखें।", items: ["POS line items", "GST-ready calculation", "Split payment", "Inventory consumption", "Staff attribution"] },
        { title: "Revenue से review", body: "Owner को branch-aware day context दें।", items: ["Cash drawer और closing", "Expenses और refunds", "Journal context", "Branch-scoped reports और comparison"], note: "Direct GST filing, complete compliance execution और हर cross-branch settlement policy claim नहीं की गई है।" },
      ] },
    },
    common: { explore: "यह experience देखें", demo: "अपने workflow पर बात करें", qualification: "ध्यान रखने वाली बात", productView: "Illustrative product view", active: "चुना हुआ" },
  },
};
