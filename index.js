// index.js

require("dotenv").config()

const express = require("express")
const Stripe = require("stripe")

// ======================================================
// CONFIGURATION
// ======================================================

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const app = express()

const PORT = process.env.PORT || 3000

const AGENT_NUMBER = process.env.AGENT_NUMBER || "397"

const EMAIL_FROM =
    process.env.EMAIL_FROM || "PROJET F <mission@projet-f.fr>"

// ======================================================
// CORS
// ======================================================

app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader(
        "Access-Control-Allow-Methods",
        "POST, GET, OPTIONS"
    )
    res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type"
    )

    if (req.method === "OPTIONS") {
        return res.sendStatus(200)
    }

    next()
})

// ======================================================
// WEBHOOK STRIPE
//
// IMPORTANT :
// cette route DOIT être placée AVANT express.json()
// Stripe a besoin du body brut pour vérifier la signature.
// ======================================================

async function stripeWebhookHandler(req, res) {
    const signature = req.headers["stripe-signature"]

    if (!signature) {
        console.error("Stripe-Signature manquante")

        return res.status(400).send(
            "Stripe-Signature manquante"
        )
    }

    if (!process.env.STRIPE_WEBHOOK_SECRET) {
        console.error(
            "STRIPE_WEBHOOK_SECRET non configuré"
        )

        return res.status(500).send(
            "Webhook Stripe non configuré"
        )
    }

    let event

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            signature,
            process.env.STRIPE_WEBHOOK_SECRET
        )
    } catch (error) {
        console.error(
            "Signature webhook Stripe invalide :",
            error.message
        )

        return res.status(400).send(
            `Webhook Error: ${error.message}`
        )
    }

    console.log(
        "Événement Stripe reçu :",
        event.type
    )

    // --------------------------------------------------
    // PAIEMENT CONFIRMÉ
    // --------------------------------------------------

    if (event.type === "payment_intent.succeeded") {
        try {
            const eventPaymentIntent =
                event.data.object

            // On récupère une version fraîche depuis Stripe
            const paymentIntent =
                await stripe.paymentIntents.retrieve(
                    eventPaymentIntent.id
                )

            // ----------------------------------------------
            // ANTI-DOUBLON
            //
            // Stripe peut renvoyer un webhook plusieurs fois.
            // On vérifie donc si le mail a déjà été envoyé.
            // ----------------------------------------------

            if (
                paymentIntent.metadata
                    ?.welcomeEmailSent === "true"
            ) {
                console.log(
                    "Email déjà envoyé pour :",
                    paymentIntent.id
                )

                return res.status(200).json({
                    received: true,
                    alreadySent: true,
                })
            }

            // ----------------------------------------------
            // EMAIL DU CLIENT
            // ----------------------------------------------

            const customerEmail =
                paymentIntent.receipt_email ||
                paymentIntent.metadata?.email

            if (!customerEmail) {
                console.error(
                    "Impossible de trouver l'email du client pour",
                    paymentIntent.id
                )

                return res.status(200).json({
                    received: true,
                    emailMissing: true,
                })
            }

            // ----------------------------------------------
            // NUMÉRO D'AGENT
            // ----------------------------------------------

            const agentNumber =
                paymentIntent.metadata?.agentNumber ||
                AGENT_NUMBER

            // ----------------------------------------------
            // ENVOI DU MAIL VIA RESEND
            // ----------------------------------------------

            await sendWelcomeEmail({
                email: customerEmail,
                agentNumber,
                paymentIntentId:
                    paymentIntent.id,
            })

            // ----------------------------------------------
            // MARQUEUR ANTI-DOUBLON DANS STRIPE
            // ----------------------------------------------

            await stripe.paymentIntents.update(
                paymentIntent.id,
                {
                    metadata: {
                        ...paymentIntent.metadata,

                        welcomeEmailSent:
                            "true",

                        welcomeEmailSentAt:
                            new Date().toISOString(),

                        agentNumber:
                            String(agentNumber),
                    },
                }
            )

            console.log(
                `Email de bienvenue envoyé à ${customerEmail} — agent n°${agentNumber}`
            )

            return res.status(200).json({
                received: true,
                emailSent: true,
            })
        } catch (error) {
            console.error(
                "Erreur pendant le traitement du paiement :",
                error
            )

            // On renvoie 500 :
            // Stripe réessaiera automatiquement le webhook.
            return res.status(500).json({
                error:
                    error.message ||
                    "Erreur pendant le traitement du webhook.",
            })
        }
    }

    // Les autres événements Stripe sont simplement confirmés.
    return res.status(200).json({
        received: true,
    })
}

// On accepte les deux URLs pendant la migration.
app.post(
    [
        "/stripe-webhook",
        "/api/stripe-webhook",
    ],
    express.raw({
        type: "application/json",
    }),
    stripeWebhookHandler
)

// ======================================================
// À PARTIR D'ICI : JSON NORMAL
// ======================================================

app.use(express.json())

// ======================================================
// FONCTION D'ENVOI EMAIL RESEND
// ======================================================

async function sendWelcomeEmail({
    email,
    agentNumber,
    paymentIntentId,
}) {
    if (!process.env.RESEND_API_KEY) {
        throw new Error(
            "RESEND_API_KEY n'est pas configurée."
        )
    }

    const subject =
        `PROJET F : Bienvenue agent n°${agentNumber}`

    const text =
        `Bienvenue à toi agent n°${agentNumber}, j'espère que tu es prêt.`

    const html = `
        <!DOCTYPE html>
        <html lang="fr">
            <head>
                <meta charset="UTF-8" />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1.0"
                />
            </head>

            <body
                style="
                    margin:0;
                    padding:0;
                    background:#ffffff;
                "
            >
                <div
                    style="
                        max-width:600px;
                        margin:0 auto;
                        padding:40px 24px;
                        font-family:Arial, Helvetica, sans-serif;
                        font-size:16px;
                        line-height:1.6;
                        color:#171717;
                    "
                >
                    <p style="margin:0;">
                        Bienvenue à toi agent n°${agentNumber}, j'espère que tu es prêt.
                    </p>
                </div>
            </body>
        </html>
    `

    const response = await fetch(
        "https://api.resend.com/emails",
        {
            method: "POST",

            headers: {
                Authorization:
                    `Bearer ${process.env.RESEND_API_KEY}`,

                "Content-Type":
                    "application/json",
            },

            body: JSON.stringify({
                from: EMAIL_FROM,
                to: [email],
                subject,
                text,
                html,
                headers: {
                    "X-Projet-F-Payment":
                        paymentIntentId,
                },
            }),
        }
    )

    const data = await response.json()

    if (!response.ok) {
        console.error(
            "Erreur Resend :",
            data
        )

        throw new Error(
            data?.message ||
            "Impossible d'envoyer l'email avec Resend."
        )
    }

    console.log(
        "Réponse Resend :",
        data
    )

    return data
}

// ======================================================
// CRÉATION DU PAYMENT INTENT
// ======================================================

async function createSubscriptionHandler(
    req,
    res
) {
    try {
        const {
            email,
            firstName,
            memberNumber,
            plan,
            priceId,
        } = req.body || {}

        // ----------------------------------------------
        // 1. Vérifications
        // ----------------------------------------------

        if (!email || !firstName) {
            return res.status(400).json({
                error:
                    "email et firstName sont requis.",
            })
        }

        if (!priceId) {
            return res.status(400).json({
                error:
                    "priceId est requis (Stripe Price ID).",
            })
        }

        // ----------------------------------------------
        // 2. Récupération du Price Stripe
        // ----------------------------------------------

        const price =
            await stripe.prices.retrieve(
                priceId
            )

        if (
            !price.unit_amount ||
            !price.currency
        ) {
            return res.status(400).json({
                error:
                    "Price Stripe invalide (amount/currency manquant).",
            })
        }

        // ----------------------------------------------
        // 3. Création du PaymentIntent
        // ----------------------------------------------

        const paymentIntent =
            await stripe.paymentIntents.create(
                {
                    amount:
                        price.unit_amount,

                    currency:
                        price.currency,

                    receipt_email:
                        email.trim(),

                    description:
                        `PROJET F – Paiement ${
                            price.unit_amount / 100
                        } ${price.currency.toUpperCase()}`,

                    metadata: {
                        email:
                            email.trim(),

                        firstName:
                            firstName,

                        memberNumber:
                            memberNumber || "",

                        plan:
                            plan || "",

                        priceId:
                            priceId,

                        agentNumber:
                            String(
                                AGENT_NUMBER
                            ),

                        welcomeEmailSent:
                            "false",
                    },

                    automatic_payment_methods: {
                        enabled: true,
                    },
                }
            )

        // ----------------------------------------------
        // 4. Réponse Framer
        // ----------------------------------------------

        return res.json({
            clientSecret:
                paymentIntent.client_secret,
        })
    } catch (error) {
        console.error(
            "Erreur create-subscription :",
            error
        )

        return res.status(500).json({
            error:
                error.message ||
                "Erreur serveur Stripe.",
        })
    }
}

// Ancienne URL :
// /create-subscription
//
// Nouvelle URL souhaitée :
// /api/create-subscription

app.post(
    [
        "/create-subscription",
        "/api/create-subscription",
    ],
    createSubscriptionHandler
)

// ======================================================
// ROUTE DE TEST SERVEUR
// ======================================================

app.get("/", (req, res) => {
    res.json({
        service: "PROJET F API",
        status: "online",
    })
})

// ======================================================
// LANCEMENT SERVEUR
// ======================================================

app.listen(PORT, () => {
    console.log(
        `PROJET F API en écoute sur le port ${PORT}`
    )
})
