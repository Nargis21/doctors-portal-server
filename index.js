const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const { MongoClient, ServerApiVersion } = require('mongodb');


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

async function run() {
    try {
        await client.connect();
        console.log("db connected")
        const serviceCollection = client.db('doctors-portal').collection('services')
        const bookingCollection = client.db('doctors-portal').collection('bookings')
        const userCollection = client.db('doctors-portal').collection('users')

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

        app.put('/user/admin/:email', verifyJWT, async (req, res) => {
            const email = req.params.email
            const requester = req.decoded.email
            const requesterAccount = await userCollection.findOne({ email: requester })
            if (requesterAccount.role === 'admin') {
                const filter = { email: email }
                const updateDoc = {
                    $set: { role: 'admin' }
                }
                const result = await userCollection.updateOne(filter, updateDoc);
                res.send(result)
            }
            else {
                res.status(403).send({ message: 'Forbidden' })
            }


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
            const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })

            res.send({ result, token })

        })

        app.get('/service', async (req, res) => {
            const query = {}
            const cursor = serviceCollection.find(query)
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

        app.post('/booking', async (req, res) => {
            const booking = req.body
            const query = { treatment: booking.treatment, date: booking.date, patientEmail: booking.patientEmail }
            const exists = await bookingCollection.findOne(query)
            if (exists) {
                return res.send({ success: false, booking: exists })
            }
            const result = await bookingCollection.insertOne(booking)
            return res.send({ success: true, result })
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