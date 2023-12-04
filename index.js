const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();
const port = process.env.PORT || 3030;

// SSL Commerce
const SSLCommerzPayment = require("sslcommerz-lts");
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_KEY;
const is_live = false;

const corsConfig = {
  origin: "*",
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
};
app.use(cors(corsConfig));
app.use(express.json());

// Verify JWT
const verifyJWT = (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ error: true, message: "unauthorized access" });
  }
  const token = authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
    if (error) {
      return res
        .status(401)
        .send({ error: true, message: "unauthorized access 2" });
    }
    req.decoded = decoded;
    next();
  });
};

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USERS}:${process.env.DB_PASS}@cluster0.pq4nrld.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
    const productCollection = client.db("amTrustMart").collection("products");
    const usersCollection = client.db("amTrustMart").collection("users");
    const cartCollection = client.db("amTrustMart").collection("carts");
    const ordersCollection = client.db("amTrustMart").collection("orders");
    // JWT
    app.post("/jwt", (req, res) => {
      const user = req.body;
      // console.log(user);
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "10h",
      });
      res.send({ token });
    });
    // Product Operations ------------------------------------------------------------
    // All product
    app.get("/products", async (req, res) => {
      const result = await productCollection.find().toArray();
      res.send(result);
    });

    // Post in cart
    app.post("/carts", verifyJWT, async (req, res) => {
      const product = req.body;
      const result = await cartCollection.insertOne(product);
      res.send(result);
    });
    // get user cart data by email
    app.get("/carts", verifyJWT, async (req, res) => {
      const email = req.query?.email;
      // console.log(email);
      if (!email) {
        res.send([]);
      }
      const decodedEmail = req.decoded.email;
      if (email !== decodedEmail) {
        return res
          .status(403)
          .send({ error: true, message: "forbidden access" });
      }
      const query = { email: email };
      const result = await cartCollection.find(query).toArray();
      res.send(result);
    });

    // Cart qty update
    app.patch("/carts", async (req, res) => {
      const id = req.body._id;
      const qty = req.body.qty;

      const filter = { _id: new ObjectId(id) };
      const update = { $set: { qty: qty } };
      const result = await cartCollection.updateOne(filter, update);
      res.send(result);
    });

    // Remove Carts
    app.delete("/carts", async (req, res) => {
      const id = req.body.id;
      // console.log(id);
      const filter = { _id: new ObjectId(id) };
      const result = await cartCollection.deleteOne(filter);
      res.send(result);
    });

    // Order Operations --------------------------------------------------------------
    app.post("/orders", async (req, res) => {
      const data = req.body;
      const result = await ordersCollection.insertOne(data);
      res.send(result);
    });

    app.delete("/deleteUserCart/:email", async (req, res) => {
      const userEmail = req.params.email;
      const query = { email: userEmail };
      const result = await cartCollection.deleteMany(query);
      // console.log(result);
      res.send(result);
    });

    // SSL Payment

    app.post("/payment", (req, res) => {
      const tran_id = new ObjectId().toString();
      const orderedDetails = req.body;
      // console.log(orderedDetails);
      const subTotalPrice = orderedDetails.productDetails.reduce(
        (total, product) => total + product.price * product.qty,
        0
      );
      const grandTotalPrice = Math.floor(
        subTotalPrice + (subTotalPrice * 15) / 100
      );
      let productName = "";
      orderedDetails.productDetails.map((item) => {
        productName = productName + "&" + item.productName;
      });
      // console.log(productName);
      const data = {
        total_amount: grandTotalPrice,
        currency: "USD",
        tran_id: tran_id,
        success_url: `http://localhost:3030/payment/success/${tran_id}`,
        fail_url: `http://localhost:3030/payment/failed/${tran_id}`,
        cancel_url: "http://localhost:3030/cancel",
        ipn_url: "http://localhost:3030/ipn",
        shipping_method: "Courier",
        product_name: productName,
        product_category: "Electronic",
        product_profile: "general",
        cus_name: orderedDetails?.userName,
        cus_email: orderedDetails?.contactEmail,
        cus_add1: orderedDetails?.address1,
        cus_add2: orderedDetails?.address2,
        cus_city: orderedDetails?.district,
        cus_state: orderedDetails?.upaZila,
        cus_postcode: "1000",
        cus_country: "Bangladesh",
        cus_phone: orderedDetails?.mobile,
        cus_fax: "01711111111",
        ship_name: orderedDetails?.userName,
        ship_add1: orderedDetails?.address1,
        ship_add2: orderedDetails?.address2,
        ship_city: orderedDetails?.district,
        ship_state: orderedDetails?.upaZila,
        ship_postcode: 1000,
        ship_country: "Bangladesh",
      };
      // console.log(data);
      const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
      sslcz.init(data).then((apiResponse) => {
        // Redirect the user to payment gateway
        let GatewayPageURL = apiResponse.GatewayPageURL;
        res.send({ url: GatewayPageURL });
        orderedDetails.transactionID = tran_id;
        const result = ordersCollection.insertOne(orderedDetails);
        // console.log("Redirecting to: ", GatewayPageURL);
      });
    });
    // Payment Successful
    app.post("/payment/success/:transactionID", async (req, res) => {
      const transactionId = req.params.transactionID;
      const query = { transactionID: transactionId };
      const result = await ordersCollection.updateOne(query, {
        $set: {
          paymentStatus: "paid",
        },
      });
      if (result.modifiedCount > 0) {
        const orderedDetails = await ordersCollection.findOne(query);
        if (orderedDetails) {
          const filter = { email: orderedDetails.userEmail };
          const result = await cartCollection.deleteMany(filter);
          res.redirect(
            `http://localhost:5173/payment/success/${transactionId}`
          );
        }
      }
    });

    //Payment Failed
    app.post("/payment/failed/:transactionID", async (req, res) => {
      // console.log("Hitting failed");
      const transactionId = req.params.transactionID;
      const query = { transactionID: transactionId };
      const result = await ordersCollection.updateOne(query, {
        $set: {
          paymentStatus: "failed",
        },
      });
      if (result.modifiedCount > 0) {
        res.redirect(`http://localhost:5173/payment/failed`);
      }
    });

    // User Operation ------------------------------------------------------------------
    // Get all user
    app.get("/users", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });
    //signIn user details post
    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const isExistUser = await usersCollection.findOne(query);

      if (isExistUser) {
        return res.send({
          errorMessage: "User already registered with this email",
        });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    // Patch user info
    app.patch("/users/:email", async (req, res) => {
      try {
        const userEmail = req.params.email; // Get the user's email from the URL parameter
        const updatedUserData = req.body; // Get the updated user data from the request body
        // console.log(updatedUserData);
        // console.log(userEmail);
        // Check if the user with the specified email exists in the database
        const user = await usersCollection.findOne({ email: userEmail });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        // Update the user's data with the new information
        await usersCollection.updateOne(
          { email: userEmail },
          { $set: updatedUserData }
        );

        res.status(200).json({ message: "User data updated successfully" });
      } catch (error) {
        console.error("Error updating user data:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    //
    app.get("/", (req, res) => {
      res.send("amTrustMart is running");
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`amTrustMart is running on port : ${port}`);
});
