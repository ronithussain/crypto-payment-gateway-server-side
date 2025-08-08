const express = require('express');
const app = express();
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.s5ifh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const testUserCollection = client.db("cryptoDB").collection("test-users"); //test korar jonno use kora holo
    const userCollection = client.db("cryptoDB").collection("users");

    const transactionCollection = client.db("cryptoDB").collection("transactions");

    // jwt token api work start here:___________________;
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    })

    // middlewares
    const verifyToken = (req, res, next) => {
      // console.log('inside verify token', req.headers.authorization);
      if (!req.headers.authorization) {
        return res.status(401).send({ message: 'unauthorized access' });
      }
      const token = req.headers.authorization.split(' ')[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decode) => {
        if (err) {
          return res.status(401).send({ message: 'unauthorized access' })
        }
        req.decoded = decode;
        next();
      })
    }
    // verifyAdmin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email; // decoded er moddhe je email chilo setake neya holo
      const query = { email: email }; // query diye present email k neya holo
      const user = await userCollection.findOne(query); // userCollection e email take findOne kora hocche
      const isAdmin = user?.role === 'admin'; // check kora hocche user er role admin ki na?
      if (!isAdmin) { // jodi admin na hoy tahole 403 forbidden access return kore dibe
        return res.status(403).send({ message: 'forbidden access' })
      };
      next(); // jodi hoy tahole next e jete parbe!

    }
    // jwt token api work ends here:____________________;






    // __________transactionCollection start here___________;
    // deposit, withdraw and transaction post api

    app.post('/api/transactions', verifyToken, async (req, res) => {
      const { userId, type, name, email, amount, description, walletAddress, paymentMethod } = req.body;
      console.log(req.body, 'payload');

      if (!userId || !type || !amount) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      if (!ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId format' });
      }

      const amountNum = Number(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }

      try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // fee এবং fee check বাদ দিলাম
        // শুধু withdrawal হলে balance check (fee ছাড়াই)
        if (type === 'withdraw') {
          if ((user.balance || 0) < amountNum) {
            return res.status(400).json({ error: 'Insufficient balance for withdrawal' });
          }
        }

        const transactionDoc = {
          name,
          email,
          userId,
          type,
          amount: amountNum,
          fee: 0,           // fee 0 রাখলাম
          status: 'pending',
          description,
          walletAddress: walletAddress || '',
          createdAt: new Date(),
          paymentMethod
        };

        const result = await transactionCollection.insertOne(transactionDoc);

        return res.json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error('Transaction error:', error);
        return res.status(500).json({ error: 'Server error' });
      }
    });



    // only user balance show secure get api:
    app.get('/usersBalance/:id', verifyToken, async (req, res) => {
      const userId = req.params.id;

      try {
        // 1. Find the user by ID
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // 2. Get all approved transactions (deposit & withdraw)
        const transactions = await transactionCollection.find({
          userId,
          status: 'approved'
        }).toArray();

        // 3. Calculate total deposit
        const totalDeposit = transactions
          .filter(tx => tx.type === 'deposit')
          .reduce((sum, tx) => sum + tx.amount, 0);

        // 4. Calculate total withdraw (include fee)
        const totalWithdraw = transactions
          .filter(tx => tx.type === 'withdraw')
          .reduce((sum, tx) => sum + tx.amount + (tx.fee || 0), 0);

        // 5. Final balance = deposit - (withdraw + fee)
        const balance = totalDeposit - totalWithdraw;

        // 6. Send combined response
        res.json({
          name: user.name,
          email: user.email,
          balance: balance
        });

      } catch (error) {
        console.error('Error fetching user and balance:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // admin approved transaction api
    app.patch('/api/transactions/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
      const transactionId = req.params.id;
      console.log(req.params.id);

      try {
        const transaction = await transactionCollection.findOne({ _id: new ObjectId(transactionId) });
        if (!transaction) {
          return res.status(404).json({ error: 'Transaction not found' });
        }

        if (transaction.status === 'approved') {
          return res.status(400).json({ error: 'Transaction already approved' });
        }

        const user = await userCollection.findOne({ _id: new ObjectId(transaction.userId) });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        let newBalance = user.balance || 0;
        const withdrawalFee = 0.05;

        if (transaction.type === 'deposit') {
          newBalance += transaction.amount;

        } else if (transaction.type === 'withdraw') {
          // যদি fee আগেই না থাকে, তাহলে হিসাব করো
          let feeAmount = transaction.fee;
          if (feeAmount === undefined || feeAmount === null) {
            feeAmount = transaction.amount * withdrawalFee;
            // fee update করো transaction এ
            await transactionCollection.updateOne(
              { _id: new ObjectId(transactionId) },
              { $set: { fee: feeAmount } }
            );
          }

          const totalDeduction = transaction.amount + feeAmount;

          if (newBalance < totalDeduction) {
            return res.status(400).json({ error: 'Insufficient balance to approve withdrawal' });
          }
          newBalance -= totalDeduction;
        }

        // ইউজার ব্যালেন্স update করো
        await userCollection.updateOne(
          { _id: new ObjectId(transaction.userId) },
          { $set: { balance: newBalance } }
        );

        // ট্রানজাকশন স্ট্যাটাস approved করো
        await transactionCollection.updateOne(
          { _id: new ObjectId(transactionId) },
          { $set: { status: 'approved' } }
        );

        res.json({ success: true, newBalance });
      } catch (error) {
        console.error('Approval error:', error);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // user-wise transaction history API
    app.get('/api/transactions/user/:userId', verifyToken, async (req, res) => {
      const userId = req.params.userId;

      try {
        const transactions = await transactionCollection.find({ userId }).sort({ createdAt: -1 }).toArray();

        res.json({ success: true, transactions });
      } catch (error) {
        console.error('Transaction history error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // Get all pending transactions admin dashboard
    app.get('/api/transactions/pending', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const result = await transactionCollection.find({ status: 'pending' }).toArray();
        res.json(result);
      } catch (error) {
        console.error('Pending tx error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });











    // __________userCollection start here _____________;
    // GET /users/email/:email
    app.get('/users/email/:email', verifyToken, async (req, res) => {
      const email = req.params.email;

      try {
        const user = await userCollection.findOne({ email: email });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        res.json(user);
      } catch (error) {
        console.error('Get user by email error:', error);
        res.status(500).json({ error: 'Server error' });
      }
    });
    // user admin or not api start here
    app.get('/users/admin/:email', verifyToken, async (req, res) => { // ekhane authProvider e je email ase seta req.body theke niye decoded er sathe present email ke check kora hocche je ai email er role ta admin ki na?
      const email = req.params.email;

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === 'admin'
      }
      res.send({ admin });
    })
    // user patch api start here:
    app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await userCollection.updateOne(filter, updatedDoc);
      res.send(result);
    })

    // user delete api start here:
    app.delete('/users/:id', verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) }
      const result = await userCollection.deleteOne(query);
      res.send(result);
    })

    // user get and search api start here:
    app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
      const search = req.query.search || '';
      const page = parseInt(req.query.page) || 0;
      const limit = parseInt(req.query.limit) || 5;
      const skip = page * limit;

      const query = search ? { name: { $regex: search, $options: 'i' } } : {};
      const result = await userCollection.find(query).skip(skip).limit(limit).toArray();
      const totalUsers = await userCollection.countDocuments(query);
      res.send({ result, totalPages: Math.ceil(totalUsers / limit) });
    })

    //  user create in the database post api start here
    app.post('/users', async (req, res) => {
      const user = req.body;
      // insert email if user dosent exists:
      const query = { email: user.email }
      const existingUser = await userCollection.findOne(query)
      if (existingUser) {
        return res.send({ message: 'user already exists', insertedId: null })
      }
      const result = await userCollection.insertOne(user);
      res.send(result)
    })
    // __________userCollection ends here _____________;










    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);


// _________________________
app.get('/', (req, res) => {
  res.send('crypto is sitting')
})

app.listen(port, () => {
  console.log(`Crypto is sitting on port ${port}`);
})