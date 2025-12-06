// index.js
require("dotenv").config()
const express = require("express")
const Stripe = require("stripe")

// On initialise Stripe avec TA clé secrète (prise dans .env)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const app = express()
app.use(express.json())

// CORS : autoriser Framer (n'importe quel domaine) à appeler l'API
app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")
    if (req.method === "OPTIONS") return res.sendStatus(200)
    next()
})

// --------------------------
//  ROUTE API PRINCIPALE
//  POST /create-subscription
// --------------------------
app.post("/create-subscription", async (req, res) => {
    try {
        const { email, firstName, memberNumber, plan, priceId } = req.body || {}

        // 1) Vérifications de base
        if (!email || !firstName) {
            return res
                .status(400)
                .json({ error: "email et firstName sont requis." })
        }

        if (!priceId) {
            return res
                .status(400)
                .json({ error: "priceId est requis (Stripe Price ID)." })
        }

        // 2) On récupère le Price Stripe pour connaître montant + devise
        const price = await stripe.prices.retrieve(priceId)

        if (!price.unit_amount || !price.currency) {
            return res.status(400).json({
                error: "Price Stripe invalide (amount/currency manquant).",
            })
        }

        // 3) On crée un PaymentIntent pour ce montant
        const paymentIntent = await stripe.paymentIntents.create({
            amount: price.unit_amount, // en centimes
            currency: price.currency,  // ex: 'eur'
            receipt_email: email,
            description:
                "Horse Actu – Paiement " + price.unit_amount / 100 + " " + price.currency,
            metadata: {
                firstName: firstName,
                memberNumber: memberNumber || "",
                plan: plan || "",
                priceId: priceId,
            },
            automatic_payment_methods: { enabled: true },
        })

        // 4) On renvoie le clientSecret à Framer
        return res.json({
            clientSecret: paymentIntent.client_secret,
        })
    } catch (err) {
        console.error(err)
        return res.status(500).json({
            error: err.message || "Erreur serveur Stripe.",
        })
    }
})

// Lancer le serveur en local
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Horse Actu Stripe API en écoute sur le port ${PORT}`)
})
