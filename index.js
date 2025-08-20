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

    // deposit, withdraw and transaction post api
    app.post('/api/transactions', verifyToken, async (req, res) => {
      const { userId, type, name, email, amount, description, walletAddress, paymentMethod } = req.body;
      // console.log(req.body, 'payload');

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

        // ✅ NEW: Withdrawal task completion check
        if (type === 'withdraw') {
          const userTaskProgress = user.taskProgress || 0;

          if (userTaskProgress < 50) {
            return res.status(400).json({
              error: 'Please complete tasks 1 to 50 before withdrawing',
              taskProgress: userTaskProgress,
              requiredTasks: 50
            });
          }

          // Existing balance check
          if ((user.balance || 0) < amountNum) {
            return res.status(400).json({ error: 'Insufficient balance for withdrawal' });
          }
        }

        // বাকি existing code unchanged...
        const transactionDoc = {
          name,
          email,
          userId,
          type,
          amount: amountNum,
          fee: 0,
          status: 'pending',
          description,
          walletAddress: walletAddress || '',
          createdAt: new Date(),
          paymentMethod
        };

        const result = await transactionCollection.insertOne(transactionDoc);
        // console.log(result, 'all deposit and withdraw successful');
        return res.json({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.error('Transaction error:', error);
        return res.status(500).json({ error: 'Server error' });
      }
    });

    // only user balance show secure get api:
    // 1. GET userBalance/:id - ইতিমধ্যে আছে, কিন্তু totalDeposits calculation যোগ করা দরকার
    // Modify existing userBalance API to include totalDeposits
    app.get('/usersBalance/:id', verifyToken, async (req, res) => {
      const userId = req.params.id;

      try {
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Calculate total approved deposits
        const depositStats = await transactionCollection.aggregate([
          {
            $match: {
              userId: userId,
              type: 'deposit',
              status: 'approved'
            }
          },
          {
            $group: {
              _id: null,
              totalDeposits: { $sum: '$amount' }
            }
          }
        ]).toArray();

        const totalDeposits = depositStats.length > 0 ? depositStats[0].totalDeposits : 0;
        const finalBalance = user.balance || 0;

        // console.log('Balance with deposits for user:', userId, 'Balance:', finalBalance, 'Deposits:', totalDeposits);

        res.json({
          name: user.name,
          email: user.email,
          balance: Number(finalBalance.toFixed(2)),
          totalDeposits: Number(totalDeposits.toFixed(2)) // Add totalDeposits
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
        // ✅ taskProgressUpdatedAt field add করুন
        const result = await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              taskProgress: progressNum,
              taskProgressUpdatedAt: new Date() // ✅ নতুন field update
            }
          }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).json({ error: 'User not found or progress not updated' });
        }

        // console.log('Task progress updated for user:', userId, 'New progress:', progressNum);

        res.json({
          success: true,
          message: 'Task progress updated successfully',
          taskProgress: progressNum,
          updatedAt: new Date() // ✅ response এ timestamp add করুন
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

        let matchStage = {
          status: 'pending'
        };

        if (search && search.trim() !== '') {
          const regex = new RegExp(search.trim(), 'i');
          matchStage.$or = [
            { name: regex },
            { email: regex },
            { type: regex },
            { paymentMethod: regex }
          ];

          if (!isNaN(search) && search !== '') {
            matchStage.$or.push({ amount: Number(search) });
          }
        }

        const result = await transactionCollection.aggregate([
          { $match: matchStage },

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
                { $limit: 1 }
              ],
              as: 'proofData'
            }
          },

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

          // ✅ Make sure taskIndex field is included in the response (for task_reward transactions)
          {
            $project: {
              proofData: 0  // Remove proofData but keep everything else including taskIndex
            }
          },

          { $sort: { createdAt: -1 } }
        ]).toArray();

        // console.log(`Found ${result.length} pending transactions`);

        if (result.length > 0) {
          console.log('First transaction:', {
            id: result[0]._id,
            name: result[0].name,
            type: result[0].type,
            taskIndex: result[0].taskIndex || 'N/A', // ✅ taskIndex log করুন
            proofUrl: result[0].proofUrl ? 'Present' : 'Missing'
          });
        }

        res.json(result);

      } catch (error) {
        console.error('Pending transactions error:', error);
        res.status(500).json({ error: 'Internal server error' });
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
        let newTotalDeposits = user.totalDeposits || 0; // ✅ নতুন variable
        const withdrawalFeeRate = 0.05;

        // Balance update logic
        if (transaction.type === 'deposit') {
          newBalance += transaction.amount;
          newTotalDeposits += transaction.amount; // ✅ totalDeposits update
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

        // ✅ Update user with balance AND totalDeposits
        const updateData = {
          balance: newBalance
        };

        // শুধু deposit approve করার সময় totalDeposits update করুন
        if (transaction.type === 'deposit') {
          updateData.totalDeposits = newTotalDeposits;
          updateData.totalDepositsUpdatedAt = new Date(); // ✅ timestamp update
        }

        await userCollection.updateOne(
          { _id: new ObjectId(transaction.userId) },
          { $set: updateData }
        );

        await transactionCollection.updateOne(
          { _id: new ObjectId(transactionId) },
          { $set: { status: 'approved', approvedAt: new Date() } }
        );

        // console.log(`Transaction ${transactionId} approved. New balance: ${newBalance}, Total deposits: ${newTotalDeposits}`);

        res.json({
          message: 'Transaction approved successfully',
          newBalance: Number(newBalance.toFixed(2)),
          totalDeposits: Number(newTotalDeposits.toFixed(2)) // ✅ response এ add করুন
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

        // console.log(result, 'payment proof saved successfully');
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
        // console.log('Received user data:', user);

        // Check if user already exists
        const query = { email: user.email };
        const existingUser = await userCollection.findOne(query);
        if (existingUser) {
          return res.send({
            message: 'User already exists',
            insertedId: null,
            referralCode: existingUser.referralCode
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

        if (!isUnique) {
          referralCode = `${user.email.substring(0, 3).toUpperCase()}${Date.now().toString().slice(-3)}`;
        }

        // ✅ Create new user data with MISSING FIELDS
        const newUser = {
          name: user.name,
          email: user.email,
          referralCode: referralCode,
          referralBalance: 0,
          totalReferrals: 0,
          balance: 0,
          taskProgress: 0,

          // ✅ ADD THESE MISSING FIELDS:
          totalDeposits: 0,                    // নতুন field
          taskProgressUpdatedAt: new Date(),   // নতুন field  
          totalDepositsUpdatedAt: new Date(),  // নতুন field

          createdAt: new Date()
        };

        // console.log('Creating user with data:', newUser);

        const result = await userCollection.insertOne(newUser);

        // Handle referral reward
        let referralReward = false;
        if (user.referralCodeFromFrontend) {
          // console.log('Processing referral code:', user.referralCodeFromFrontend);

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
            // console.log('Referral reward applied to:', refUser.name);
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
        // console.log('Validating referral code:', referralCode); // Debug log

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
          // console.log('Valid referral code found for user:', refUser.name); // Debug log
          res.json({
            valid: true,
            message: 'Valid referral code',
            referrerName: refUser.name
          });
        } else {
          // console.log('Invalid referral code:', referralCode); // Debug log
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
        // console.log('Fetching referral info for:', email); // Debug log

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

        // console.log('Sending referral info:', responseData); // Debug log
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

        // console.log('Complete Task Request:', { userId, taskId, reward });

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

        // console.log(`Task ${taskId} completed for user ${userId}. Reward: $${rewardAmount}`);

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









    // 1. GET userReferrals/:userId - নতুন API যোগ করা দরকার
    app.get('/userReferrals/:userId', verifyToken, async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Get referrals count from user document or count them
        let totalReferrals = user.totalReferrals || 0;

        // If not stored, count referrals by referralCode
        if (!totalReferrals && user.referralCode) {
          const referralCount = await userCollection.countDocuments({
            referredBy: user.referralCode
          });
          totalReferrals = referralCount;
        }

        res.json({
          totalReferrals: totalReferrals,
          referralCode: user.referralCode,
          referralBalance: user.referralBalance || 0,
          userId: userId
        });

      } catch (error) {
        console.error('Error fetching user referrals:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // 2. POST validateTaskAccess/:userId - নতুন validation API
    app.post('/validateTaskAccess/:userId', verifyToken, async (req, res) => {
      try {
        const userId = req.params.userId;
        const { taskIndex } = req.body;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (typeof taskIndex !== 'number' || taskIndex < 0) {
          return res.status(400).json({ error: 'Invalid task index' });
        }

        // Get user data
        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Get total approved deposits
        const depositStats = await transactionCollection.aggregate([
          {
            $match: {
              userId: userId,
              type: 'deposit',
              status: 'approved'
            }
          },
          {
            $group: {
              _id: null,
              totalDeposits: { $sum: '$amount' }
            }
          }
        ]).toArray();

        const totalDeposits = depositStats.length > 0 ? depositStats[0].totalDeposits : 0;
        const totalReferrals = user.totalReferrals || 0;

        // Task requirements matching frontend surveyTasks array
        const taskRequirements = {
          // First task requires $50 minimum deposit
          0: { minDeposit: 50 },

          // Task 17 (index 16) requires 10 referrals
          16: { requiredReferrals: 10 },

          // Special deposit tasks matching frontend
          25: { requiredDeposit: 80 },    // Task 26
          30: { requiredDeposit: 140 },   // Task 31  
          36: { requiredDeposit: 320 },   // Task 37
          39: { requiredDeposit: 730 },   // Task 40
          41: { requiredDeposit: 1300 },  // Task 42
          42: { requiredDeposit: 2500 },  // Task 43
          43: { requiredDeposit: 5000 },  // Task 44
          44: { requiredDeposit: 8000 },  // Task 45
          45: { requiredDeposit: 15000 }, // Task 46
          46: { requiredDeposit: 25000 }, // Task 47
          47: { requiredDeposit: 40000 }, // Task 48
          48: { requiredDeposit: 60000 }, // Task 49
          49: { requiredDeposit: 100000 } // Task 50
        };

        const requirement = taskRequirements[taskIndex];
        let validation = { valid: true };

        if (requirement) {
          // Check minimum deposit for first task
          if (requirement.minDeposit && totalDeposits < requirement.minDeposit) {
            validation = {
              valid: false,
              type: 'initial_deposit',
              required: requirement.minDeposit,
              message: `Minimum deposit of $${requirement.minDeposit} required`
            };
          }
          // Check referrals requirement
          else if (requirement.requiredReferrals && totalReferrals < requirement.requiredReferrals) {
            validation = {
              valid: false,
              type: 'referrals',
              required: requirement.requiredReferrals,
              current: totalReferrals,
              message: `${requirement.requiredReferrals} referrals required`
            };
          }
          // Check special deposit requirement
          else if (requirement.requiredDeposit && totalDeposits < requirement.requiredDeposit) {
            validation = {
              valid: false,
              type: 'deposit',
              required: requirement.requiredDeposit,
              message: `Deposit of $${requirement.requiredDeposit} required`
            };
          }
        }

        res.json({
          validation,
          userStats: {
            totalDeposits,
            totalReferrals,
            taskProgress: user.taskProgress || 0,
            balance: user.balance || 0
          }
        });

      } catch (error) {
        console.error('Error validating task access:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // 3. POST completeTaskProfit/:userId - নতুন API task complete এর জন্য
    app.post('/completeTaskProfit/:userId', verifyToken, async (req, res) => {
      try {
        const userId = req.params.userId;
        const { taskIndex, reward } = req.body;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }

        if (typeof taskIndex !== 'number' || typeof reward !== 'number') {
          return res.status(400).json({ error: 'Invalid task data' });
        }

        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        const currentProgress = user.taskProgress || 0;
        if (currentProgress !== taskIndex) {
          return res.status(400).json({ error: 'Invalid task sequence' });
        }

        const session = client.startSession();

        try {
          await session.withTransaction(async () => {
            // ✅ taskProgressUpdatedAt field update করুন
            await userCollection.updateOne(
              { _id: new ObjectId(userId) },
              {
                $inc: { balance: reward },
                $set: {
                  taskProgress: currentProgress + 1,
                  taskProgressUpdatedAt: new Date() // ✅ এই field update করুন
                }
              },
              { session }
            );

            // Record task completion transaction with taskIndex
            await transactionCollection.insertOne({
              userId: userId,
              type: 'task_reward',
              amount: reward,
              description: `Live Trading Task ${taskIndex + 1} completion reward`,
              status: 'approved',
              taskIndex: taskIndex, // ✅ এই field frontend এ দেখাবে
              createdAt: new Date(),
              name: user.name,
              email: user.email
            }, { session });
          });

          // console.log(`LiveProfit Task ${taskIndex + 1} completed for user ${userId}. Reward: $${reward}`);

          res.json({
            success: true,
            message: 'Task completed successfully',
            reward: reward,
            newTaskProgress: currentProgress + 1,
            newBalance: (user.balance || 0) + reward,
            updatedAt: new Date() // ✅ response এ timestamp add করুন
          });

        } finally {
          await session.endSession();
        }

      } catch (error) {
        console.error('Error completing live profit task:', error);
        res.status(500).json({
          error: error.message || 'Internal server error'
        });
      }
    });


    // 4. GET userStats/:userId - Comprehensive stats API
    app.get('/userStats/:userId', verifyToken, async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }

        const user = await userCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Get deposit stats
        const depositStats = await transactionCollection.aggregate([
          {
            $match: {
              userId: userId,
              type: 'deposit',
              status: 'approved'
            }
          },
          {
            $group: {
              _id: null,
              totalDeposits: { $sum: '$amount' },
              depositCount: { $sum: 1 }
            }
          }
        ]).toArray();

        // Get live trading task stats
        const taskStats = await transactionCollection.aggregate([
          {
            $match: {
              userId: userId,
              type: 'task_reward'
            }
          },
          {
            $group: {
              _id: null,
              totalTaskRewards: { $sum: '$amount' },
              completedTasks: { $sum: 1 }
            }
          }
        ]).toArray();

        const stats = {
          balance: user.balance || 0,
          taskProgress: user.taskProgress || 0,
          totalReferrals: user.totalReferrals || 0,
          referralBalance: user.referralBalance || 0,
          totalDeposits: depositStats.length > 0 ? depositStats[0].totalDeposits : 0,
          depositCount: depositStats.length > 0 ? depositStats[0].depositCount : 0,
          totalTaskRewards: taskStats.length > 0 ? taskStats[0].totalTaskRewards : 0,
          completedLiveTasks: taskStats.length > 0 ? taskStats[0].completedTasks : 0,
          referralCode: user.referralCode,
          email: user.email,
          name: user.name
        };

        res.json({
          success: true,
          stats: stats
        });

      } catch (error) {
        console.error('Error fetching user stats:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });

    // ==================== Helper APIs ====================

    // 5. PATCH updateTotalDeposits/:userId - Helper for when deposits are approved
    app.patch('/updateTotalDeposits/:userId', verifyToken, verifyAdmin, async (req, res) => {
      try {
        const userId = req.params.userId;

        if (!ObjectId.isValid(userId)) {
          return res.status(400).json({ error: 'Invalid user ID' });
        }

        // Calculate total approved deposits
        const depositStats = await transactionCollection.aggregate([
          {
            $match: {
              userId: userId,
              type: 'deposit',
              status: 'approved'
            }
          },
          {
            $group: {
              _id: null,
              totalDeposits: { $sum: '$amount' }
            }
          }
        ]).toArray();

        const totalDeposits = depositStats.length > 0 ? depositStats[0].totalDeposits : 0;

        // Update user document with total deposits
        await userCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              totalDeposits: totalDeposits,
              totalDepositsUpdatedAt: new Date()
            }
          }
        );

        res.json({
          success: true,
          totalDeposits: totalDeposits,
          message: 'Total deposits updated'
        });

      } catch (error) {
        console.error('Error updating total deposits:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
    });











    // Migration route - একবার চালান existing users এর জন্য
    app.post('/migrate-user-fields', verifyToken, verifyAdmin, async (req, res) => {
      try {
        // console.log('Starting user fields migration...');

        // Find all users without the new fields
        const usersToUpdate = await userCollection.find({
          $or: [
            { totalDeposits: { $exists: false } },
            { taskProgressUpdatedAt: { $exists: false } },
            { totalDepositsUpdatedAt: { $exists: false } }
          ]
        }).toArray();

        // console.log(`Found ${usersToUpdate.length} users to update`);

        let updatedCount = 0;

        for (const user of usersToUpdate) {
          // Calculate actual totalDeposits for each user
          const depositStats = await transactionCollection.aggregate([
            {
              $match: {
                userId: user._id.toString(),
                type: 'deposit',
                status: 'approved'
              }
            },
            {
              $group: {
                _id: null,
                totalDeposits: { $sum: '$amount' }
              }
            }
          ]).toArray();

          const actualTotalDeposits = depositStats.length > 0 ? depositStats[0].totalDeposits : 0;

          // Update user with missing fields
          await userCollection.updateOne(
            { _id: user._id },
            {
              $set: {
                totalDeposits: actualTotalDeposits,
                taskProgressUpdatedAt: user.createdAt || new Date(),
                totalDepositsUpdatedAt: user.createdAt || new Date()
              }
            }
          );

          updatedCount++;
        }

        // console.log(`Migration completed. Updated ${updatedCount} users.`);

        res.json({
          success: true,
          message: `Migration completed successfully`,
          updatedUsers: updatedCount
        });

      } catch (error) {
        console.error('Migration error:', error);
        res.status(500).json({
          error: 'Migration failed',
          message: error.message
        });
      }
    });

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
  // console.log(`Crypto is sitting on port ${port}`);
})