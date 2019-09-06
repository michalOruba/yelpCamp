var express = require("express");
var router = express.Router();
var Campground = require("../models/campground");
var middleware = require("../middleware");
var NodeGeocoder = require('node-geocoder');
var User = require("../models/user");
var Notification = require("../models/notification");
var Review = require("../models/review");
var Comment = require("../models/comment");
 
var options = {
  provider: 'google',
  httpAdapter: 'https',
  apiKey: process.env.GEOCODER_API_KEY,
  formatter: null
};
 
var geocoder = NodeGeocoder(options);

var multer = require('multer');
var storage = multer.diskStorage({
  filename: function(req, file, callback) {
    callback(null, Date.now() + file.originalname);
  }
});
var imageFilter = function (req, file, cb) {
    // accept image files only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
        return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
};
var upload = multer({ storage: storage, fileFilter: imageFilter})

var cloudinary = require('cloudinary');
cloudinary.config({ 
  cloud_name: 'mikeoruba', 
  api_key: process.env.CLOUDINARY_API_KEY, 
  api_secret: process.env.CLOUDINARY_API_SECRET
});


//INDEX - show all campgrounds
router.get("/", function(req, res){
    var perPage = 8;
    var pageQuery = parseInt(req.query.page);
    var pageNumber = pageQuery ? pageQuery : 1;
    
    if(req.query.search) {
        const regex = new RegExp(escapeRegex(req.query.search), 'gi');
        Campground.find({name: regex}, function(err,allCampgrounds){
           if (err){
               console.log(err);
           }
           else {
               if (allCampgrounds < 1){
                   req.flash("error", "No campgrounds match that search. Please try again.");
                   res.redirect("/campgrounds");
               } else {
                   res.render("campgrounds/index", {campgrounds: allCampgrounds, page: 'campgrounds'});
               }
           }
        });
    } else {
    Campground.find({}).skip((perPage * pageNumber) - perPage).limit(perPage).exec(function(err, allCampgrounds){
        Campground.countDocuments().exec(function (err, count) {
           if (err){
               console.log(err);
           }
           else {
               res.render("campgrounds/index", {
                    campgrounds: allCampgrounds,
                    current: pageNumber,
                    pages: Math.ceil(count / perPage)
                });
           }
        });
    });
    }
});

//CREATE - add new campground to DB
router.post("/", middleware.isLoggedIn, upload.single('image'), function(req, res) {
    
    cloudinary.v2.uploader.upload(req.file.path, function(err, result) {
        if (err){
            req.flash('error', err.message);
            return res.redirect('back');
        }
        //get data form form and add to campground array
        var name = req.body.name;
        var price = req.body.price;
        var image = result.secure_url;
        var imageId = result.public_id;
        var desc = req.body.description;
        var author = {
            id: req.user._id,
            username: req.user.username
        }
        geocoder.geocode(req.body.location, async function (err, data) {
            if (err || !data.length) {
              req.flash('error', 'Invalid address');
              console.log("GOOGLE MAPS ERROR: " + err);
              return res.redirect('back');
            }
            var lat = data[0].latitude;
            var lng = data[0].longitude;
            var location = data[0].formattedAddress;
            var newCampground = {name: name, price: price, image: image, imageId: imageId, description: desc, author: author, location: location, lat: lat, lng: lng};
            try{
                let campground = await Campground.create(newCampground);
                let user = await User.findById(req.user._id).populate('followers').exec();
                let  newNotification = {
                    username: req.user.username,
                    campgroundId: campground.id
                };
                for(const follower of user.followers) {
                    let notification = await Notification.create(newNotification);
                    follower.notifications.push(notification);
                    follower.save();
                }
                res.redirect('/campgrounds/' + campground.id);
            } catch (err) {
                req.flash('error', err.message);
                return res.redirect('back');
            }
        });
    });
});


//NEW - show form to create new campground
router.get("/new", middleware.isLoggedIn, function(req, res) {
   res.render("campgrounds/new.ejs") ;
});

//SHOW - shows more info about one campground
router.get("/:id", function(req, res) {
    Campground.findById(req.params.id).populate("comments").populate({
        path: "reviews",
        options: {sort: {createdAt: -1}}
    }).exec(function(err, foundCampground){
       if(err || !foundCampground){
            console.log(err);
            req.flash('error', 'Sorry, that campground does not exist!');
            return res.redirect('/campgrounds');
       }
       else{
           console.log(foundCampground);
           res.render("campgrounds/show", {campground: foundCampground});
       }
    });
    //find the campground with provided ID
    //render show template with that campground 
});


// EDIT CAMPGROUND ROUTE
router.get("/:id/edit", middleware.checkCampgroundOwnership, function(req, res) {
        res.render("campgrounds/edit", {campground: req.campground});
});

// UPDATE CAMPGROUND ROUTE

router.put("/:id", middleware.checkCampgroundOwnership, upload.single('image'), function(req, res){
        geocoder.geocode(req.body.location, function (err, data) {
            if (err || !data.length) {
              req.flash('error', 'Invalid address');
              return res.redirect('back');
            }
            req.body.campground.lat = data[0].latitude;
            req.body.campground.lng = data[0].longitude;
            req.body.campground.location = data[0].formattedAddress;
        
            // find and update the correct campground
            Campground.findById(req.params.id, async function(err, campground){
                if(err){
                    req.flash('error', err.message);
                    return res.redirect('back');
                } else {
                        if(req.file) {
                            try {
                                await cloudinary.v2.uploader.destroy(campground.imageId);
                                var result = await cloudinary.v2.uploader.upload(req.file.path);
                                req.body.campground.imageId = result.public_id;
                                req.body.campground.image = result.secure_url;
                            } catch (err) {
                                req.flash('error', err.message);
                                return res.redirect('back');
                            }
                            
                        }
                        Campground.findByIdAndUpdate(req.params.id, req.body.campground, function(err){
                            if(err){
                                req.flash('error', err.message);
                                return res.redirect('back');
                            } else {
                                res.redirect("/campgrounds/" + req.params.id);
                            }
                        });
                }
            });
        });
});


module.exports = router;


// DESTROY CAMPGROUND ROUTE

router.delete("/:id", middleware.checkCampgroundOwnership, function(req, res){
    Campground.findById(req.params.id, async function(err, foundCampground){
        if(err){
            req.flash('error', err.message);
            return res.redirect('back');
        } else {
            try{
                await cloudinary.v2.uploader.destroy(foundCampground.imageId);
                await Comment.remove({"_id": {$in: foundCampground.comments}});
                await Review.remove({"_id": {$in: foundCampground.reviews}});
                foundCampground.remove();
                req.flash("success", "Campground deleted successfully");
                res.redirect("/campgrounds");
            } catch(err) {
                req.flash('error', err.message);
                return res.redirect('back');
            }
        }
    })
});


function escapeRegex(text){
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}