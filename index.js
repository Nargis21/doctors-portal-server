const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);


const app = express()
const port = process.env.PORT || 5000;

// middlewares
app.use(cors())
app.use(express.json())


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.qb5ap.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader) {
        return res.status(401).send({ message: 'unauthorized access' })
    }
    const token = authHeader.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden access' })
        }
        req.decoded = decoded
        next()
    });

}
var emailSenderOptions = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}

var emailClient = nodemailer.createTransport(sgTransport(emailSenderOptions));

function sendAppointmentEmai(booking) {
    const { patientEmail, patientName, date, slot, treatment } = booking
    var email = {
        from: process.env.EMAIL_SENDER,
        to: patientEmail,
        subject: `Your Appointment for ${treatment} on ${date} at ${slot} is confirmed`,
        text: `Your Appointment for ${treatment} on ${date} at ${slot} is confirmed`,
        html: `
        <div>
        <p>Hello ${patientName},</p>
        <h3>Your appointment for ${treatment} is confirmed</h3>
        <p>Looking forword to seeing you on ${date} at ${slot}</p>
        <h3>Our Address</h3>
        <p>Awal Centre</p>
        <p>Dhaka</p>
        <a href="https://www.programming-hero.com/">Unsubscribe</a>
    </div>

        `
    };

    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent:', info);
        }
    });

}

async function run() {
    try {
        await client.connect();
        console.log("db connected")
        const serviceCollection = client.db('doctors-portal').collection('services')
        const bookingCollection = client.db('doctors-portal').collection('bookings')
        const userCollection = client.db('doctors-portal').collection('users')
        const doctorCollection = client.db('doctors-portal').collection('doctors')
        const paymentCollection = client.db('doctors-portal').collection('payments')

        const verifyAdmin = async (req, res, next) => {
            const requester = req.decoded.email
            const requesterAccount = await userCollection.findOne({ email: requester })
            if (requesterAccount.role === 'admin') {
                next()
            }
            else {
                res.status(403).send({ message: 'Forbidden' })
            }
        }

        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email
            const user = await userCollection.findOne({ email: email })
            const isAdmin = user.role === 'admin'
            console.log(isAdmin)
            res.send({ admin: isAdmin })
        })

        app.get('/user', verifyJWT, async (req, res) => {
            const users = await userCollection.find().toArray()
            res.send(users)
        })

        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const updateDoc = {
                $set: { role: 'admin' }
            }
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result)
        })
        app.put('/user/:email', async (req, res) => {
            const email = req.params.email
            const user = req.body
            const filter = { email: email }
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            }
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' })

            res.send({ result, token })

        })

        app.get('/service', async (req, res) => {
            const query = {}
            const cursor = serviceCollection.find(query).project({ name: 1 })
            const services = await cursor.toArray()
            res.send(services)
        })

        app.get('/available', async (req, res) => {
            const date = req.query.date || 'May 15, 2022'
            //  Step-1: get all services
            const services = await serviceCollection.find().toArray()
            // Step-2: get the booking of that day. output: [{},{},{}]
            const query = { date: date }
            const bookings = await bookingCollection.find(query).toArray()
            //Step-3: for each service
            services.forEach(service => {
                //Step-4: find booking for that service. output: [{},{},{}]
                const serviceBookings = bookings.filter(booking => booking.treatment === service.name)
                //Step-5: select slots for service booking. output [" "," "." "]
                const bookedSlots = serviceBookings.map(booking => booking.slot)
                //Step-6: select those slot that are not in bookedslots
                const available = service.slots.filter(slot => !bookedSlots.includes(slot))
                //set available to slot
                service.slots = available
            })
            res.send(services)

        })

        app.get('/booking', verifyJWT, async (req, res) => {
            const patient = req.query.patient
            const decodedEmail = req.decoded.email
            if (decodedEmail === patient) {
                const query = { patientEmail: patient }
                const appointments = await bookingCollection.find(query).toArray()
                res.send(appointments)
            }
            else {
                return res.status(403).send({ message: 'Forbidden access' })
            }

        })

        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const query = { _id: ObjectId(id) }
            const booking = await bookingCollection.findOne(query)
            res.send(booking)
        })

        app.post('/booking', async (req, res) => {
            const booking = req.body
            const query = { treatment: booking.treatment, date: booking.date, patientEmail: booking.patientEmail }
            const exists = await bookingCollection.findOne(query)
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking)
            sendAppointmentEmai(booking)
            return res.send({ success: true, result })
        })

        app.patch('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id
            const payment = req.body
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const result = await paymentCollection.insertOne(payment)
            const updatedBooking = await bookingCollection.updateOne(filter, updatedDoc)
            res.send(updatedBooking)
        })

        app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctor = req.body
            const result = await doctorCollection.insertOne(doctor)
            res.send(result)
        })

        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const doctors = await doctorCollection.find().toArray()
            res.send(doctors)
        })
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email
            const filter = { email: email }
            const doctors = await doctorCollection.deleteOne(filter)
            res.send(doctors)
        })

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const service = req.body
            const price = service.price
            const amount = price * 100
            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: "usd",
                payment_method_types: ['card']
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })
    }
    finally {

    }

}
run().catch(console.dir)


app.get('/', (req, res) => {
    res.send('Hello From Doctor Uncle :)')
})

app.listen(port, () => {
    console.log('Doctors Portal, Listening to port', port)
})