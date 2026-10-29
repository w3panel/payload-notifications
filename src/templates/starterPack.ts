import type {
  NotificationEventRegistry,
  NotificationTemplateDefinition,
  NotificationTemplateRegistry,
  NotificationTemplateSet,
} from '../types'

export type StarterPackName = 'ecommerce' | 'auth' | 'saas'

type StarterEntry = {
  pack: StarterPackName
  label: string
  description: string
  classification: 'transactional' | 'marketing'
  samplePayload: Record<string, unknown>
  email: NotificationTemplateDefinition
  sms: string
  whatsapp: string
  inapp: NotificationTemplateDefinition
}

const greeting = 'Hi {{ recipient.name | default "there" }},'

const html = (lines: string[], cta?: { label: string; url: string }) =>
  [
    ...lines.map((line) => `<p>${line}</p>`),
    ...(cta
      ? [
          `<p><a href="${cta.url}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${cta.label}</a></p>`,
        ]
      : []),
  ].join('\n')

const STARTERS: Record<string, StarterEntry> = {
  'order.paid': {
    pack: 'ecommerce',
    label: 'Order paid',
    description: 'Payment confirmed for an order',
    classification: 'transactional',
    samplePayload: {
      orderId: 'ORD-1042',
      total: 2499,
      currency: 'INR',
      orderUrl: 'https://example.com/orders/ORD-1042',
    },
    email: {
      subject: 'Order {{ payload.orderId }} confirmed',
      preheader: 'We received your payment of {{ payload.currency }} {{ payload.total }}',
      body: `${greeting}\n\nThanks for your order {{ payload.orderId }}. We received your payment of {{ payload.currency }} {{ payload.total }}.\n\nView your order: {{ payload.orderUrl }}`,
      htmlBody: html(
        [
          greeting,
          'Thanks for your order <strong>{{ payload.orderId }}</strong>. We received your payment of {{ payload.currency }} {{ payload.total }}.',
        ],
        { label: 'View order', url: '{{ payload.orderUrl }}' },
      ),
    },
    sms: 'Order {{ payload.orderId }} confirmed. Paid {{ payload.currency }} {{ payload.total }}.',
    whatsapp:
      'Your order {{ payload.orderId }} is confirmed ✅ Paid {{ payload.currency }} {{ payload.total }}. {{ payload.orderUrl }}',
    inapp: {
      title: 'Order confirmed',
      body: 'Order {{ payload.orderId }} is confirmed.',
      actionUrl: '{{ payload.orderUrl }}',
    },
  },
  'order.shipped': {
    pack: 'ecommerce',
    label: 'Order shipped',
    description: 'An order left the warehouse',
    classification: 'transactional',
    samplePayload: {
      orderId: 'ORD-1042',
      carrier: 'BlueDart',
      trackingNumber: 'BD123456',
      trackingUrl: 'https://example.com/track/BD123456',
    },
    email: {
      subject: 'Order {{ payload.orderId }} has shipped',
      preheader: 'Track it with {{ payload.carrier }}',
      body: `${greeting}\n\nYour order {{ payload.orderId }} is on its way with {{ payload.carrier }} (tracking {{ payload.trackingNumber }}).\n\nTrack it: {{ payload.trackingUrl }}`,
      htmlBody: html(
        [
          greeting,
          'Your order <strong>{{ payload.orderId }}</strong> is on its way with {{ payload.carrier }}.',
        ],
        { label: 'Track shipment', url: '{{ payload.trackingUrl }}' },
      ),
    },
    sms: 'Order {{ payload.orderId }} shipped via {{ payload.carrier }}. Track: {{ payload.trackingUrl }}',
    whatsapp: 'Your order {{ payload.orderId }} has shipped 🚚 Track it: {{ payload.trackingUrl }}',
    inapp: {
      title: 'Order shipped',
      body: 'Order {{ payload.orderId }} is on its way.',
      actionUrl: '{{ payload.trackingUrl }}',
    },
  },
  'order.delivered': {
    pack: 'ecommerce',
    label: 'Order delivered',
    description: 'An order was delivered',
    classification: 'transactional',
    samplePayload: { orderId: 'ORD-1042', reviewUrl: 'https://example.com/orders/ORD-1042/review' },
    email: {
      subject: 'Order {{ payload.orderId }} delivered',
      preheader: 'Tell us how it went',
      body: `${greeting}\n\nYour order {{ payload.orderId }} was delivered. We'd love your feedback: {{ payload.reviewUrl }}`,
      htmlBody: html(
        [greeting, 'Your order <strong>{{ payload.orderId }}</strong> was delivered.'],
        { label: 'Leave a review', url: '{{ payload.reviewUrl }}' },
      ),
    },
    sms: 'Order {{ payload.orderId }} delivered. Review it: {{ payload.reviewUrl }}',
    whatsapp:
      'Your order {{ payload.orderId }} was delivered 📦 How was it? {{ payload.reviewUrl }}',
    inapp: {
      title: 'Order delivered',
      body: 'Order {{ payload.orderId }} was delivered.',
      actionUrl: '{{ payload.reviewUrl }}',
    },
  },
  'order.cancelled': {
    pack: 'ecommerce',
    label: 'Order cancelled',
    description: 'An order was cancelled',
    classification: 'transactional',
    samplePayload: { orderId: 'ORD-1042', reason: 'Requested by customer' },
    email: {
      subject: 'Order {{ payload.orderId }} cancelled',
      body: `${greeting}\n\nYour order {{ payload.orderId }} was cancelled.{{#if payload.reason}} Reason: {{ payload.reason }}.{{/if}} Any payment will be refunded to the original method.`,
    },
    sms: 'Order {{ payload.orderId }} was cancelled. Any payment will be refunded.',
    whatsapp:
      'Your order {{ payload.orderId }} was cancelled. Any payment will be refunded to the original method.',
    inapp: { title: 'Order cancelled', body: 'Order {{ payload.orderId }} was cancelled.' },
  },
  'payment.failed': {
    pack: 'ecommerce',
    label: 'Payment failed',
    description: 'A payment attempt failed',
    classification: 'transactional',
    samplePayload: {
      orderId: 'ORD-1042',
      amount: 2499,
      currency: 'INR',
      retryUrl: 'https://example.com/orders/ORD-1042/pay',
    },
    email: {
      subject: 'Payment for order {{ payload.orderId }} failed',
      preheader: 'Retry to keep your order',
      body: `${greeting}\n\nWe couldn't process your payment of {{ payload.currency }} {{ payload.amount }} for order {{ payload.orderId }}. Retry here: {{ payload.retryUrl }}`,
      htmlBody: html(
        [
          greeting,
          "We couldn't process your payment of {{ payload.currency }} {{ payload.amount }} for order <strong>{{ payload.orderId }}</strong>.",
        ],
        { label: 'Retry payment', url: '{{ payload.retryUrl }}' },
      ),
    },
    sms: 'Payment for order {{ payload.orderId }} failed. Retry: {{ payload.retryUrl }}',
    whatsapp:
      'Payment for order {{ payload.orderId }} failed ⚠️ Retry here: {{ payload.retryUrl }}',
    inapp: {
      title: 'Payment failed',
      body: 'Retry payment for order {{ payload.orderId }}.',
      actionUrl: '{{ payload.retryUrl }}',
      priority: 'high',
    },
  },
  'cart.abandoned': {
    pack: 'ecommerce',
    label: 'Cart abandoned',
    description: 'Items left in a cart',
    classification: 'marketing',
    samplePayload: { itemCount: 2, cartUrl: 'https://example.com/cart' },
    email: {
      subject: 'You left {{ payload.itemCount }} items in your cart',
      preheader: 'They are still waiting for you',
      body: `${greeting}\n\nYou left {{ payload.itemCount }} items in your cart. Complete your order: {{ payload.cartUrl }}{{#if unsubscribeUrl}}\n\nUnsubscribe: {{ unsubscribeUrl }}{{/if}}`,
      htmlBody: html([greeting, 'You left {{ payload.itemCount }} items in your cart.'], {
        label: 'Return to cart',
        url: '{{ payload.cartUrl }}',
      }),
    },
    sms: 'Your cart is waiting: {{ payload.cartUrl }}',
    whatsapp: 'You left {{ payload.itemCount }} items in your cart 🛒 {{ payload.cartUrl }}',
    inapp: {
      title: 'Your cart is waiting',
      body: '{{ payload.itemCount }} items are still in your cart.',
      actionUrl: '{{ payload.cartUrl }}',
    },
  },
  'refund.processed': {
    pack: 'ecommerce',
    label: 'Refund processed',
    description: 'A refund was issued',
    classification: 'transactional',
    samplePayload: { orderId: 'ORD-1042', amount: 2499, currency: 'INR' },
    email: {
      subject: 'Refund for order {{ payload.orderId }} processed',
      body: `${greeting}\n\nWe refunded {{ payload.currency }} {{ payload.amount }} for order {{ payload.orderId }}. It can take 5–7 business days to appear.`,
    },
    sms: 'Refund of {{ payload.currency }} {{ payload.amount }} for order {{ payload.orderId }} processed.',
    whatsapp:
      'Your refund of {{ payload.currency }} {{ payload.amount }} for order {{ payload.orderId }} has been processed 💸',
    inapp: {
      title: 'Refund processed',
      body: '{{ payload.currency }} {{ payload.amount }} refunded for order {{ payload.orderId }}.',
    },
  },
  'auth.magic-link': {
    pack: 'auth',
    label: 'Magic sign-in link',
    description: 'Passwordless sign-in link',
    classification: 'transactional',
    samplePayload: { url: 'https://example.com/auth/verify?token=…', expiresInMinutes: 15 },
    email: {
      subject: 'Your sign-in link',
      preheader: 'Expires in {{ payload.expiresInMinutes | default "15" }} minutes',
      body: `${greeting}\n\nSign in with this link (expires in {{ payload.expiresInMinutes | default "15" }} minutes): {{ payload.url }}\n\nIf you didn't request it, ignore this email.`,
      htmlBody: html(
        [
          greeting,
          'Use the button below to sign in. The link expires in {{ payload.expiresInMinutes | default "15" }} minutes.',
        ],
        { label: 'Sign in', url: '{{ payload.url }}' },
      ),
    },
    sms: 'Your sign-in link: {{ payload.url }}',
    whatsapp: 'Your sign-in link: {{ payload.url }}',
    inapp: {
      title: 'Sign-in link sent',
      body: 'A secure sign-in link was generated for your account.',
    },
  },
  'auth.otp': {
    pack: 'auth',
    label: 'One-time code',
    description: 'Verification code (OTP)',
    classification: 'transactional',
    samplePayload: { code: '482913', expiresInMinutes: 10 },
    email: {
      subject: 'Your verification code: {{ payload.code }}',
      body: `Your verification code is {{ payload.code }}. It expires in {{ payload.expiresInMinutes | default "10" }} minutes. Never share it with anyone.`,
    },
    sms: '{{ payload.code }} is your verification code. It expires in {{ payload.expiresInMinutes | default "10" }} min. Do not share it.',
    whatsapp: '{{ payload.code }} is your verification code. Do not share it.',
    inapp: { title: 'Verification code', body: 'Use code {{ payload.code }} to continue.' },
  },
  'auth.password-reset': {
    pack: 'auth',
    label: 'Password reset',
    description: 'Password reset link',
    classification: 'transactional',
    samplePayload: { url: 'https://example.com/reset?token=…' },
    email: {
      subject: 'Reset your password',
      body: `${greeting}\n\nReset your password here: {{ payload.url }}\n\nIf you didn't ask for this, you can ignore this email.`,
      htmlBody: html([greeting, 'We received a request to reset your password.'], {
        label: 'Reset password',
        url: '{{ payload.url }}',
      }),
    },
    sms: 'Reset your password: {{ payload.url }}',
    whatsapp: 'Reset your password: {{ payload.url }}',
    inapp: { title: 'Password reset requested', body: 'A password reset link was sent to you.' },
  },
  'user.welcome': {
    pack: 'auth',
    label: 'Welcome',
    description: 'New account welcome',
    classification: 'transactional',
    samplePayload: { appName: 'Example', dashboardUrl: 'https://example.com/dashboard' },
    email: {
      subject: 'Welcome to {{ payload.appName | default "our app" }}',
      body: `${greeting}\n\nWelcome aboard! Get started here: {{ payload.dashboardUrl }}`,
      htmlBody: html([greeting, 'Welcome aboard! We are glad you are here.'], {
        label: 'Get started',
        url: '{{ payload.dashboardUrl }}',
      }),
    },
    sms: 'Welcome to {{ payload.appName | default "our app" }}! Get started: {{ payload.dashboardUrl }}',
    whatsapp:
      'Welcome to {{ payload.appName | default "our app" }} 👋 Get started: {{ payload.dashboardUrl }}',
    inapp: {
      title: 'Welcome!',
      body: 'Your account is ready.',
      actionUrl: '{{ payload.dashboardUrl }}',
    },
  },
  'user.email-verified': {
    pack: 'auth',
    label: 'Email verified',
    description: 'Email address confirmed',
    classification: 'transactional',
    samplePayload: { email: 'alex@example.com' },
    email: {
      subject: 'Email verified',
      body: `${greeting}\n\n{{ payload.email }} is now verified.`,
    },
    sms: 'Your email {{ payload.email }} is verified.',
    whatsapp: 'Your email {{ payload.email }} is verified ✅',
    inapp: { title: 'Email verified', body: '{{ payload.email }} is verified.' },
  },
  'subscription.created': {
    pack: 'saas',
    label: 'Subscription started',
    description: 'A subscription was created',
    classification: 'transactional',
    samplePayload: {
      plan: 'Pro',
      amount: 999,
      currency: 'INR',
      interval: 'month',
      billingUrl: 'https://example.com/billing',
    },
    email: {
      subject: 'Your {{ payload.plan }} subscription is active',
      body: `${greeting}\n\nYour {{ payload.plan }} plan is active: {{ payload.currency }} {{ payload.amount }} per {{ payload.interval }}. Manage billing: {{ payload.billingUrl }}`,
    },
    sms: 'Your {{ payload.plan }} subscription is active.',
    whatsapp: 'Your {{ payload.plan }} subscription is active 🎉',
    inapp: {
      title: 'Subscription active',
      body: '{{ payload.plan }} plan activated.',
      actionUrl: '{{ payload.billingUrl }}',
    },
  },
  'subscription.renewal-reminder': {
    pack: 'saas',
    label: 'Renewal reminder',
    description: 'Upcoming subscription renewal',
    classification: 'transactional',
    samplePayload: {
      plan: 'Pro',
      renewsAt: '2026-11-30T00:00:00.000Z',
      amount: 999,
      currency: 'INR',
      billingUrl: 'https://example.com/billing',
    },
    email: {
      subject: 'Your {{ payload.plan }} plan renews on {{ date payload.renewsAt "MMM d" }}',
      body: `${greeting}\n\nYour {{ payload.plan }} plan renews on {{ date payload.renewsAt "MMM d, yyyy" }} for {{ payload.currency }} {{ payload.amount }}. Manage billing: {{ payload.billingUrl }}`,
    },
    sms: '{{ payload.plan }} renews on {{ date payload.renewsAt "MMM d" }} for {{ payload.currency }} {{ payload.amount }}.',
    whatsapp:
      'Reminder: your {{ payload.plan }} plan renews on {{ date payload.renewsAt "MMM d" }}.',
    inapp: {
      title: 'Renewal coming up',
      body: '{{ payload.plan }} renews on {{ date payload.renewsAt "MMM d" }}.',
      actionUrl: '{{ payload.billingUrl }}',
    },
  },
  'subscription.payment-failed': {
    pack: 'saas',
    label: 'Subscription payment failed',
    description: 'A renewal charge failed',
    classification: 'transactional',
    samplePayload: { plan: 'Pro', billingUrl: 'https://example.com/billing' },
    email: {
      subject: 'Payment for your {{ payload.plan }} plan failed',
      body: `${greeting}\n\nWe couldn't charge your card for the {{ payload.plan }} plan. Update your payment method to avoid interruption: {{ payload.billingUrl }}`,
      htmlBody: html([greeting, "We couldn't charge your card for the {{ payload.plan }} plan."], {
        label: 'Update payment method',
        url: '{{ payload.billingUrl }}',
      }),
    },
    sms: 'Payment for your {{ payload.plan }} plan failed. Update: {{ payload.billingUrl }}',
    whatsapp:
      'Payment for your {{ payload.plan }} plan failed ⚠️ Update your card: {{ payload.billingUrl }}',
    inapp: {
      title: 'Payment failed',
      body: 'Update your payment method for {{ payload.plan }}.',
      actionUrl: '{{ payload.billingUrl }}',
      priority: 'high',
    },
  },
  'invoice.created': {
    pack: 'saas',
    label: 'Invoice created',
    description: 'A new invoice is available',
    classification: 'transactional',
    samplePayload: {
      invoiceNumber: 'INV-2026-0042',
      amount: 999,
      currency: 'INR',
      dueAt: '2026-11-15T00:00:00.000Z',
      invoiceUrl: 'https://example.com/invoices/INV-2026-0042',
    },
    email: {
      subject: 'Invoice {{ payload.invoiceNumber }}',
      body: `${greeting}\n\nInvoice {{ payload.invoiceNumber }} for {{ payload.currency }} {{ payload.amount }} is due {{ date payload.dueAt "MMM d, yyyy" }}. View it: {{ payload.invoiceUrl }}`,
    },
    sms: 'Invoice {{ payload.invoiceNumber }}: {{ payload.currency }} {{ payload.amount }} due {{ date payload.dueAt "MMM d" }}.',
    whatsapp:
      'Invoice {{ payload.invoiceNumber }} ({{ payload.currency }} {{ payload.amount }}) is ready: {{ payload.invoiceUrl }}',
    inapp: {
      title: 'New invoice',
      body: 'Invoice {{ payload.invoiceNumber }} is ready.',
      actionUrl: '{{ payload.invoiceUrl }}',
    },
  },
  'booking.confirmed': {
    pack: 'saas',
    label: 'Booking confirmed',
    description: 'An appointment was booked',
    classification: 'transactional',
    samplePayload: {
      bookingId: 'BK-311',
      service: 'Consultation',
      startsAt: '2026-11-02T09:30:00.000Z',
      location: 'Clinic A',
      bookingUrl: 'https://example.com/bookings/BK-311',
    },
    email: {
      subject: 'Booking confirmed: {{ payload.service }} on {{ date payload.startsAt "MMM d" }}',
      body: `${greeting}\n\nYour {{ payload.service }} is booked for {{ date payload.startsAt "MMM d, yyyy h:mm a" }}{{#if payload.location}} at {{ payload.location }}{{/if}}. Details: {{ payload.bookingUrl }}`,
      htmlBody: html(
        [
          greeting,
          'Your <strong>{{ payload.service }}</strong> is booked for {{ date payload.startsAt "MMM d, yyyy h:mm a" }}.',
        ],
        { label: 'View booking', url: '{{ payload.bookingUrl }}' },
      ),
    },
    sms: '{{ payload.service }} booked for {{ date payload.startsAt "MMM d h:mm a" }}. {{ payload.bookingUrl }}',
    whatsapp:
      'Your {{ payload.service }} is confirmed for {{ date payload.startsAt "MMM d, h:mm a" }} ✅ {{ payload.bookingUrl }}',
    inapp: {
      title: 'Booking confirmed',
      body: '{{ payload.service }} on {{ date payload.startsAt "MMM d, h:mm a" }}.',
      actionUrl: '{{ payload.bookingUrl }}',
    },
  },
  'booking.reminder': {
    pack: 'saas',
    label: 'Booking reminder',
    description: 'Reminder before an appointment',
    classification: 'transactional',
    samplePayload: {
      bookingId: 'BK-311',
      service: 'Consultation',
      startsAt: '2026-11-02T09:30:00.000Z',
      location: 'Clinic A',
      bookingUrl: 'https://example.com/bookings/BK-311',
    },
    email: {
      subject: 'Reminder: {{ payload.service }} {{ date payload.startsAt "MMM d, h:mm a" }}',
      body: `${greeting}\n\nThis is a reminder of your {{ payload.service }} on {{ date payload.startsAt "MMM d, yyyy h:mm a" }}{{#if payload.location}} at {{ payload.location }}{{/if}}. Need to change it? {{ payload.bookingUrl }}`,
    },
    sms: 'Reminder: {{ payload.service }} on {{ date payload.startsAt "MMM d h:mm a" }}. {{ payload.bookingUrl }}',
    whatsapp:
      'Reminder ⏰ {{ payload.service }} on {{ date payload.startsAt "MMM d, h:mm a" }}. {{ payload.bookingUrl }}',
    inapp: {
      title: 'Upcoming booking',
      body: '{{ payload.service }} on {{ date payload.startsAt "MMM d, h:mm a" }}.',
      actionUrl: '{{ payload.bookingUrl }}',
    },
  },
  'ticket.updated': {
    pack: 'saas',
    label: 'Support ticket updated',
    description: 'A support ticket changed',
    classification: 'transactional',
    samplePayload: {
      ticketId: 'T-77',
      status: 'Answered',
      ticketUrl: 'https://example.com/support/T-77',
    },
    email: {
      subject: 'Ticket {{ payload.ticketId }}: {{ payload.status }}',
      body: `${greeting}\n\nYour support ticket {{ payload.ticketId }} is now {{ payload.status }}. View it: {{ payload.ticketUrl }}`,
    },
    sms: 'Ticket {{ payload.ticketId }} is now {{ payload.status }}.',
    whatsapp:
      'Your ticket {{ payload.ticketId }} is now {{ payload.status }}. {{ payload.ticketUrl }}',
    inapp: {
      title: 'Ticket {{ payload.ticketId }} updated',
      body: 'Status: {{ payload.status }}.',
      actionUrl: '{{ payload.ticketUrl }}',
    },
  },
  'system.alert': {
    pack: 'saas',
    label: 'System alert',
    description: 'Operational alert for admins',
    classification: 'transactional',
    samplePayload: {
      severity: 'warning',
      message: 'Queue backlog above threshold',
      dashboardUrl: 'https://example.com/admin',
    },
    email: {
      subject: '[{{ uppercase payload.severity }}] {{ payload.message }}',
      body: `{{ payload.message }}\n\nSeverity: {{ payload.severity }}\nDashboard: {{ payload.dashboardUrl }}`,
    },
    sms: '[{{ uppercase payload.severity }}] {{ payload.message }}',
    whatsapp: '🚨 [{{ uppercase payload.severity }}] {{ payload.message }}',
    inapp: {
      title: 'System alert',
      body: '{{ payload.message }}',
      actionUrl: '{{ payload.dashboardUrl }}',
      priority: 'urgent',
    },
  },
}

export const STARTER_PACKS: StarterPackName[] = ['ecommerce', 'auth', 'saas']

const selected = (packs: boolean | StarterPackName[] | undefined): StarterPackName[] =>
  packs === true ? STARTER_PACKS : Array.isArray(packs) ? packs : []

/** Code registry templates for the selected starter packs. */
export const starterTemplates = (
  packs: boolean | StarterPackName[] = true,
): NotificationTemplateRegistry => {
  const names = selected(packs)
  return Object.fromEntries(
    Object.entries(STARTERS)
      .filter(([, entry]) => names.includes(entry.pack))
      .map(([slug, entry]) => [
        slug,
        {
          email: entry.email,
          sms: entry.sms,
          whatsapp: entry.whatsapp,
          inapp: entry.inapp,
        } satisfies NotificationTemplateSet,
      ]),
  )
}

/** Event definitions (label, classification, sample payload) for the selected starter packs. */
export const starterEvents = (
  packs: boolean | StarterPackName[] = true,
): NotificationEventRegistry => {
  const names = selected(packs)
  return Object.fromEntries(
    Object.entries(STARTERS)
      .filter(([, entry]) => names.includes(entry.pack))
      .map(([slug, entry]) => [
        slug,
        {
          label: entry.label,
          description: entry.description,
          classification: entry.classification,
          samplePayload: entry.samplePayload,
        },
      ]),
  )
}

/** Template slugs per starter pack. */
export const starterTemplateSlugs = (pack: StarterPackName): string[] =>
  Object.entries(STARTERS)
    .filter(([, entry]) => entry.pack === pack)
    .map(([slug]) => slug)
