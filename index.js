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

    const userCollection = client.db("cryptoDB").collection("users");

    const transactionCollection = client.db("cryptoDB").collection("transactions");
    const paymentsCollection = client.db("cryptoDB").collection("payment-proof");

    // jwt token api work start here:___________________;
    app.post('/jwt', async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '7d' });
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
        // console.log('The backend token is',token);
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
        console.log(result, 'all deposit and withdraw successful');
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
        // শুধু user এর data নিন, কোন calculation না
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // ✅ user.balance এ সব কিছু ইতিমধ্যে calculated আছে
        const finalBalance = user.balance || 0;

        console.log('Simple balance for user:', userId, 'Balance:', finalBalance);

        res.json({
          name: user.name,
          email: user.email,
          balance: Number(finalBalance.toFixed(2))
        });

      } catch (error) {
        console.error('Error fetching user balance:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    // balance update route for liveProfit Button
    app.patch('/usersBalance/:id', verifyToken, async (req, res) => {
      const userId = req.params.id;
      const { amount } = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId format' });
      }

      const amountNum = Number(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        return res.status(400).json({ error: 'Invalid amount' });
      }

      try {
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          { $inc: { balance: amountNum } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'User not found or balance not updated' });
        }

        res.json({ success: true, message: 'Balance updated successfully' });
      } catch (error) {
        console.error('Balance update error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    // =================== USER TASK PROGRESS APIs ===================

    // 1. GET userTaskProgress - User এর task progress দেখার জন্য
    app.get('/userTaskProgress/:id', verifyToken, async (req, res) => {
      const userId = req.params.id;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId format' });
      }

      try {
        // User find করুন
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Task progress return করুন (default 0 if not exists)
        res.json({
          taskProgress: user.taskProgress || 0,
          totalTasks: 50, // আপনার total task সংখ্যা
          message: 'Task progress fetched successfully'
        });

      } catch (error) {
        console.error('Error fetching task progress:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // 2. PATCH userTaskProgress - User এর task progress update করার জন্য
    app.patch('/userTaskProgress/:id', verifyToken, async (req, res) => {
      const userId = req.params.id;
      const { taskProgress } = req.body;

      if (!ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId format' });
      }

      const progressNum = Number(taskProgress);
      if (isNaN(progressNum) || progressNum < 0) {
        return res.status(400).json({ error: 'Invalid task progress' });
      }

      try {
        // User এর taskProgress field update করুন
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: { taskProgress: progressNum }
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'User not found or progress not updated' });
        }

        // Debug log
        console.log('Task progress updated for user:', userId, 'New progress:', progressNum);

        res.json({
          success: true,
          message: 'Task progress updated successfully',
          taskProgress: progressNum
        });

      } catch (error) {
        console.error('Task progress update error:', error);
        res.status(500).json({ error: 'Internal server error' });
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
    // Fixed Backend API - Pending Transactions
    app.get('/api/transactions/pending', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const search = req.query.search || '';

        // Basic match stage for pending transactions
        let matchStage = {
          status: 'pending'
        };

        // Add search functionality only if search term exists
        if (search && search.trim() !== '') {
          const regex = new RegExp(search.trim(), 'i');
          matchStage.$or = [
            { name: regex },
            { email: regex },
            { type: regex },
            { paymentMethod: regex }
          ];

          // Add amount search if search term is a number
          if (!isNaN(search) && search !== '') {
            matchStage.$or.push({ amount: Number(search) });
          }
        }

        console.log('Match stage:', JSON.stringify(matchStage, null, 2));

        const result = await transactionCollection.aggregate([
          { $match: matchStage },

          // Lookup with proper error handling
          {
            $lookup: {
              from: 'payment-proof',
              let: { transactionIdStr: { $toString: "$_id" } },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ["$transactionId", "$$transactionIdStr"] }
                  }
                },
                { $limit: 1 } // Only get first matching proof
              ],
              as: 'proofData'
            }
          },

          // Add proofUrl field
          {
            $addFields: {
              proofUrl: {
                $cond: {
                  if: { $gt: [{ $size: "$proofData" }, 0] },
                  then: { $arrayElemAt: ['$proofData.proofUrl', 0] },
                  else: null
                }
              }
            }
          },

          // Remove proofData from final result
          { $project: { proofData: 0 } },

          // Sort by creation date (newest first)
          { $sort: { createdAt: -1 } }
        ]).toArray();

        console.log(`Found ${result.length} pending transactions`);

        // Debug: Log first transaction
        if (result.length > 0) {
          console.log('First transaction:', {
            id: result[0]._id,
            name: result[0].name,
            email: result[0].email,
            amount: result[0].amount,
            proofUrl: result[0].proofUrl ? 'Present' : 'Missing'
          });
        }

        res.json(result);

      } catch (error) {
        console.error('Pending transactions error:', error);
        console.error('Error stack:', error.stack);

        // Send more detailed error in development
        if (process.env.NODE_ENV === 'development') {
          res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            stack: error.stack
          });
        } else {
          res.status(500).json({ error: 'Internal server error' });
        }
      }
    });


    // admin approved transaction api use aggregate pipeline:
    app.get('/api/transactions/deposits', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const deposits = await transactionCollection.aggregate([
          { $match: { type: 'deposit' } }, // শুধু deposit
          {
            $lookup: {
              from: 'users', // তোমার userCollection এর নাম
              localField: 'userId',
              foreignField: '_id',
              as: 'user'
            }
          },
          { $unwind: '$user' }, // user array unwrap
          {
            $project: {
              _id: 1,
              type: 1,
              status: 1,
              amount: 1,
              createdAt: 1,
              name: '$user.name',
              email: '$user.email',
              paymentMethod: 1,
            }
          },
          { $sort: { createdAt: -1 } }
        ]).toArray();

        res.json({ success: true, deposits });
      } catch (error) {
        console.error('Deposit fetch error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });


    // admin panel user all deposit pending to approved status, decline, get api:
    // Approve transaction API
    // ✅ Approve API ও সরল করুন (আগের কোড ঠিক করে)
    app.patch('/api/transactions/approve/:id', verifyToken, verifyAdmin, async (req, res) => {
      const transactionId = req.params.id;

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
        const withdrawalFeeRate = 0.05; // 5%

        // ✅ Balance update logic
        if (transaction.type === 'deposit') {
          newBalance += transaction.amount;
        }
        else if (transaction.type === 'withdraw') {
          let feeAmount = transaction.fee;

          if (feeAmount === undefined || feeAmount === null) {
            feeAmount = transaction.amount * withdrawalFeeRate;
            await transactionCollection.updateOne(
              { _id: new ObjectId(transactionId) },
              { $set: { fee: feeAmount } }
            );
          }

          const totalDeduction = transaction.amount + feeAmount;

          if (newBalance < totalDeduction) {
            return res.status(400).json({ error: 'Insufficient balance' });
          }

          newBalance -= totalDeduction;
        }

        // ✅ Update both transaction status and user balance
        await userCollection.updateOne(
          { _id: new ObjectId(transaction.userId) },
          { $set: { balance: newBalance } }
        );

        await transactionCollection.updateOne(
          { _id: new ObjectId(transactionId) },
          { $set: { status: 'approved', approvedAt: new Date() } }
        );

        console.log(`Transaction ${transactionId} approved. New balance: ${newBalance}`);

        res.json({
          message: 'Transaction approved successfully',
          newBalance: Number(newBalance.toFixed(2))
        });

      } catch (error) {
        console.error('Error approving transaction:', error);
        res.status(500).json({ error: 'Failed to approve transaction' });
      }
    });


    // admin panel all user deposit pending to rejected decline patch api:
    app.patch('/api/transactions/reject/:id', verifyToken, verifyAdmin, async (req, res) => {
      const transactionId = req.params.id;

      try {
        const transaction = await transactionCollection.findOne({ _id: new ObjectId(transactionId) });
        if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

        if (transaction.status !== 'pending') {
          return res.status(400).json({ error: 'Only pending transactions can be rejected' });
        }

        await transactionCollection.updateOne(
          { _id: new ObjectId(transactionId) },
          { $set: { status: 'rejected' } }
        );

        res.json({ success: true, message: 'Transaction rejected' });
      } catch (error) {
        console.error('Reject error:', error);
        res.status(500).json({ error: 'Server error' });
      }
    });

    // 1 image screenshot post api wort start here:
    app.post("/api/payment-proof", async (req, res) => {
      try {
        const {
          proofUrl,
          name,
          email,
          dbUserId,
          transactionId, // ✅ এটা missing ছিল
          walletAddress,
          uploadedAt
        } = req.body;

        // ✅ Validation ঠিক করা
        if (!proofUrl || !dbUserId || !walletAddress || !transactionId) {
          return res.status(400).json({
            error: "proofUrl, transactionId, dbUserId, and walletAddress are required"
          });
        }

        // ✅ Database insert ঠিক করা
        const result = await paymentsCollection.insertOne({
          name,
          email,
          proofUrl,
          dbUserId: new ObjectId(dbUserId), // ✅ dhUserId -> dbUserId এবং string to ObjectId convert
          transactionId, // ✅ এটা add করা
          walletAddress, // ✅ এটা missing ছিল
          uploadedAt: uploadedAt ? new Date(uploadedAt) : new Date(), // ✅ frontend থেকে আসা date handle করা
          status: 'pending' // ✅ default status add করা
        });

        console.log(result, 'payment proof saved successfully');
        res.status(201).json({
          success: true,
          insertedId: result.insertedId,
          message: "Payment proof submitted successfully"
        });

      } catch (err) {
        console.error("Payment proof save error:", err);
        res.status(500).json({
          error: "Failed to save payment proof",
          details: err.message // ✅ error details add করা debugging এর জন্য
        });
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
      const { role } = req.body;  // ক্লায়েন্ট থেকে নতুন role নিবে

      if (!role || (role !== 'admin' && role !== 'user')) {
        return res.status(400).send({ message: 'Invalid role' });
      }

      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          role: role
        }
      };

      try {
        const result = await userCollection.updateOne(filter, updatedDoc);
        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Failed to update role' });
      }
    });

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
    // app.post('/users', async (req, res) => {
    //   const user = req.body;
    //   // insert email if user dosent exists:
    //   const query = { email: user.email }
    //   const existingUser = await userCollection.findOne(query)
    //   if (existingUser) {
    //     return res.send({ message: 'user already exists', insertedId: null })
    //   }
    //   const result = await userCollection.insertOne(user);
    //   res.send(result)
    // })

    // নতুন ইউজার রেজিস্ট্রেশন + রেফারেল হ্যান্ডেল
    // ===== FIXED BACKEND ROUTES =====

    // Users Registration Route - Fixed and referral start work start here________________________________:
    app.post('/users', async (req, res) => {
      try {
        const user = req.body;
        console.log('Received user data:', user); // Debug log

        // Check if user already exists
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);
        if (existingUser) {
          return res.send({
            message: 'User already exists',
            insertedId: null,
            referralCode: existingUser.referralCode // Send existing code
          });
        }

        // Generate unique referral code
        let referralCode;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
          referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          const existingCode = await userCollection.findOne({ referralCode });
          if (!existingCode) {
            isUnique = true;
          }
          attempts++;
        }

        // Fallback if unable to generate unique code
        if (!isUnique) {
          referralCode = `${user.email.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-3)}`;
        }

        // Create new user data
        const newUser = {
          name: user.name,
          email: user.email,
          referralCode: referralCode,
          referralBalance: 0,
          totalReferrals: 0,
          balance: 0,
          taskProgress: 0,
          createdAt: new Date()
        };

        console.log('Creating user with data:', newUser); // Debug log

        const result = await userCollection.insertOne(newUser);

        // Handle referral reward
        let referralReward = false;
        if (user.referralCodeFromFrontend) {
          console.log('Processing referral code:', user.referralCodeFromFrontend); // Debug log

          const refUser = await userCollection.findOne({
            referralCode: user.referralCodeFromFrontend.trim().toUpperCase()
          });

          if (refUser) {
            await userCollection.updateOne(
              { referralCode: user.referralCodeFromFrontend.trim().toUpperCase() },
              {
                $inc: {
                  referralBalance: 10,
                  totalReferrals: 1,
                  balance: 10
                }
              }
            );
            referralReward = true;
            console.log('Referral reward applied to:', refUser.name); // Debug log
          }
        }

        res.send({
          message: 'User registered successfully',
          insertedId: result.insertedId,
          referralCode: referralCode,
          referralApplied: referralReward
        });

      } catch (error) {
        console.error('User registration error:', error);
        res.status(500).send({
          message: 'Internal server error',
          error: error.message
        });
      }
    });

    // Referral Code Validation Route - Fixed
    app.post('/validate-referral', async (req, res) => {
      try {
        const { referralCode } = req.body;
        console.log('Validating referral code:', referralCode); // Debug log

        if (!referralCode || referralCode.length < 3) {
          return res.json({
            valid: false,
            message: 'Referral code must be at least 3 characters'
          });
        }

        const refUser = await userCollection.findOne({
          referralCode: referralCode.trim().toUpperCase()
        });

        if (refUser) {
          console.log('Valid referral code found for user:', refUser.name); // Debug log
          res.json({
            valid: true,
            message: 'Valid referral code',
            referrerName: refUser.name
          });
        } else {
          console.log('Invalid referral code:', referralCode); // Debug log
          res.json({
            valid: false,
            message: 'Invalid referral code'
          });
        }
      } catch (error) {
        console.error('Referral validation error:', error);
        res.status(500).json({
          valid: false,
          message: 'Server error',
          error: error.message
        });
      }
    });

    // Get Referral Info Route - Fixed  
    app.get('/referral-info/:email', async (req, res) => {
      try {
        const email = req.params.email;
        console.log('Fetching referral info for:', email); // Debug log

        const user = await userCollection.findOne({ email });

        if (!user) {
          return res.status(404).json({
            message: 'User not found',
            referralCode: '',
            referralBalance: 0,
            totalReferrals: 0
          });
        }

        // Ensure user has a referral code
        if (!user.referralCode) {
          let referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();

          // Update user with new referral code
          await userCollection.updateOne(
            { email },
            { $set: { referralCode: referralCode } }
          );

          user.referralCode = referralCode;
        }

        const responseData = {
          referralCode: user.referralCode,
          referralBalance: user.referralBalance || 0,
          totalReferrals: user.totalReferrals || 0
        };

        console.log('Sending referral info:', responseData); // Debug log
        res.json(responseData);

      } catch (error) {
        console.error('Get referral info error:', error);
        res.status(500).json({
          message: 'Internal server error',
          error: error.message,
          referralCode: '',
          referralBalance: 0,
          totalReferrals: 0
        });
      }
    });

    // ===== ADDITIONAL HELPER ROUTES =====

    // Get all users with referral codes (for debugging)
    app.get('/debug/users', async (req, res) => {
      try {
        const users = await userCollection.find(
          {},
          { projection: { name: 1, email: 1, referralCode: 1, totalReferrals: 1 } }
        ).toArray();

        res.json({
          total: users.length,
          users: users
        });
      } catch (error) {
        console.error('Debug users error:', error);
        res.status(500).json({ message: 'Error fetching users' });
      }
    });

    // Force regenerate referral code for a user
    app.post('/regenerate-referral/:email', async (req, res) => {
      try {
        const email = req.params.email;

        let referralCode;
        let isUnique = false;
        let attempts = 0;

        while (!isUnique && attempts < 10) {
          referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
          const existingCode = await userCollection.findOne({ referralCode });
          if (!existingCode) {
            isUnique = true;
          }
          attempts++;
        }

        const result = await userCollection.updateOne(
          { email },
          { $set: { referralCode: referralCode } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: 'User not found' });
        }

        res.json({
          message: 'Referral code regenerated',
          referralCode: referralCode
        });

      } catch (error) {
        console.error('Regenerate referral error:', error);
        res.status(500).json({ message: 'Error regenerating referral code' });
      }
    });
    // Users Registration Route - Fixed and referral work ends here________________________________:






    // daily Profit task-center work start here_____________________________________:
    // POST /complete-task
    // 1. GET user tasks - User এর completed tasks দেখার জন্য
    app.get('/userTasks/:userId', verifyToken, async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await userCollection.findOne({ _id: new ObjectId(userId) });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // User এর completed tasks return করো
        res.json({
          completedTasks: user.completedTasks || [],
          message: 'User tasks fetched successfully'
        });

      } catch (error) {
        console.error('Get user tasks error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // 2. POST complete task - Task complete করার জন্য main route
    app.post('/completeTask', verifyToken, async (req, res) => {
      try {
        const { userId, taskId, reward, timestamp } = req.body;

        console.log('Complete Task Request:', { userId, taskId, reward });

        // Validation
        if (!userId || !taskId || !reward) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!ObjectId.isValid(userId)) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }

        // User find করো
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Current completed tasks নিয়ে আসো
        let completedTasks = user.completedTasks || [];
        const currentBalance = user.balance || 0;
        const rewardAmount = Number(reward);

        // Daily task logic
        if (taskId === 'daily_login') {
          const existingTask = completedTasks.find(task => task.taskId === taskId);

          if (existingTask) {
            // Check if 24 hours passed
            const lastCompleted = new Date(existingTask.timestamp).getTime();
            const now = new Date().getTime();
            const timeDiff = now - lastCompleted;

            if (timeDiff < (24 * 60 * 60 * 1000)) {
              return res.status(400).json({
                error: 'Daily task already completed today. Try again tomorrow.'
              });
            }

            // Update existing daily task timestamp
            completedTasks = completedTasks.map(task =>
              task.taskId === taskId
                ? { ...task, timestamp: timestamp || new Date().toISOString() }
                : task
            );
          } else {
            // Add new daily task
            completedTasks.push({
              taskId,
              timestamp: timestamp || new Date().toISOString(),
              reward: rewardAmount
            });
          }
        } else {
          // One-time tasks (profile_complete, telegram_join)
          const taskExists = completedTasks.some(task => task.taskId === taskId);

          if (taskExists) {
            return res.status(400).json({
              error: 'This task has already been completed'
            });
          }

          // Add one-time task
          completedTasks.push({
            taskId,
            timestamp: timestamp || new Date().toISOString(),
            reward: rewardAmount
          });
        }

        // Database update করো
        const updateResult = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: { completedTasks },
            $inc: { balance: rewardAmount } // Main balance এ টাকা add করো
          }
        );

        if (updateResult.modifiedCount === 0) {
          return res.status(500).json({ error: 'Failed to update user data' });
        }

        console.log(`Task ${taskId} completed for user ${userId}. Reward: $${rewardAmount}`);

        res.json({
          success: true,
          message: `Task completed successfully! You earned $${rewardAmount}`,
          newBalance: currentBalance + rewardAmount,
          completedTasks
        });

      } catch (error) {
        console.error('Complete task error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });
    // daily Profit task work ends here_____________________________________:


    // ✅ Check if user has deposited at least once
    app.get('/api/check-deposit/:email', async (req, res) => {
      try {
        const email = req.params.email;

        const deposit = await depositsCollection.findOne({ email: email });

        if (deposit && deposit.amount > 0) {
          return res.json({ hasDeposited: true });
        } else {
          return res.json({ hasDeposited: false });
        }
      } catch (error) {
        console.error("Deposit check error:", error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });
    // ✅ Check how many referrals a user has
    app.get('/api/check-referrals/:email', async (req, res) => {
      try {
        const email = req.params.email;

        const referralCount = await referralsCollection.countDocuments({ referredBy: email });

        return res.json({ referrals: referralCount });
      } catch (error) {
        console.error("Referral check error:", error);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    });













    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
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