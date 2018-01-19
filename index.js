var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var fs = require('fs');
var https = require('https');
var search = require('youtube-search');
var ffmpeg = require('fluent-ffmpeg');
const ytdl = require('ytdl-core');
var API_KEY = process.env['API_KEY'];

var options = {
    pfx: fs.readFileSync('/certs/cert.pfx'),
    passphrase: ''
};

//
// Initialize the Alexa SDK
var Alexa = require('alexa-sdk');

ffmpeg.setFfmpegPath("./node_modules/ffmpeg-binaries/bin/ffmpeg.exe");

var opts = {
    maxResults: 10,
    type: 'video',
    key: 'API_KEY'
};

app.use(express.static('/tmp/youtube-skill'))

app.use(bodyParser.json());

app.post('/', function(req, res) {

    //
    // Build the context manually, because Amazon Lambda is missing
    console.log("Request received");
    //console.dir(req);

    var context = {

        succeed: function (result) {

            if (!res.headersSent) {

                console.log(result);

                res.json(result);
            }
            else {
                
                console.log("Tried to send response when headers were already sent.");
            }

        },
        fail: function (error) {

            console.log(error);
        }
    };

    //
    // Delegate the request to the Alexa SDK and the declared intent-handlers
    var alexa = Alexa.handler(req.body, context);

    alexa.registerHandlers(handlers);

    alexa.execute();
});

var handlers = {
    'LaunchRequest': function() {

        this.response.speak("Hello, what would you like to hear?").listen("");

        this.emit(':responseReady');
    },
    'SearchIntent': function() {

        var _this = this;

        var utterance = this.event.request.intent.slots.SEARCH.value;

        this.response.speak("You wanted to search for " + utterance);

        search(utterance, opts, function(err, results) {

            if (err) {
                
                console.error(err);

                _this.response.speak("There was an error searching youtube.");

                _this.emit(":responseReady");
            }

            console.log('number of results is', results.length);

            _this.attributes["promptedHandler"] = 'PlayVideo';
            _this.attributes["currentVideo"] = results[0];

            _this.response.speak("I found " + results[0].title).listen("Would you like me to play it?");

            _this.emit(':responseReady');
        });
    },
    'PlayVideo': function() {

        var _this = this;

        var video = this.attributes["currentVideo"];

        if (this.attributes["streamUrl"]) {
            
            playUrl(_this, this.attributes["streamUrl"]);
        }
        else if (fs.existsSync("/tmp/youtube-skill/" + filterTitle(video.title) + ".m4a")) {

            console.log("Found video");

            playUrl(_this, 'https://ggnocloud.westus.cloudapp.azure.com/' + filterTitle(video.title) + ".m4a");
        }
        else if (!this.attributes["downloading"]) {

            processResult(_this, video);
        }
        else {

            var w = fs.watch("/tmp/youtube-skill", { persistent: true }, function(event, filename) {
                
                w.close();
                
                if (filename == (filterTitle(video.title) + ".m4a")) {

                    _this.response.speak("Finished downloading " + video.title);

                    _this.emit(":responseReady");
                }
            });

            setTimeout(() => {

                w.close();

                _this.response.speak("Its taking a while to download the audio").listen("Would you like to wait?");

                _this.emit(":responseReady");

            }, 5000);
        }
    },
    'YesIntent': function() {

        if (this.attributes["promptedHandler"]) {

            this.emit(this.attributes["promptedHandler"]);

            return;
        }

        this.response.speak("Sorry, I don't know what the question was.");

        this.emit(':responseReady');
    },
    'NoIntent': function() {

        this.response.speak("Okay");

        this.emit(':responseReady');
    },
    'SessionEndedRequest': function() {

        console.log('session ended!');

        this.attributes['endedSessionCount'] += 1;
    },
    'AMAZON.StopIntent': function() {
        
        console.log('session ended!');

        this.emit(':responseReady');
    },
    'PlaybackStarted' : function() {

        console.log('Alexa begins playing the audio stream');
        
        this.emit(':responseReady');
    },
    'PlaybackFinished' : function() {

        console.log('The stream comes to an end');
        
        this.emit(':responseReady');
    },
    'PlaybackStopped' : function() {

        console.log('Alexa stops playing the audio stream');
        
        this.emit(':responseReady');
    },
    'PlaybackNearlyFinished' : function() {

        console.log('The currently playing stream is nearly complate and the device is ready to receive a new stream');
        
        this.emit(':responseReady');
    },
    'PlaybackFailed' : function() {

        console.log('Alexa encounters an error when attempting to play a stream');
        
        this.emit(':responseReady');
    },
    'System.ExceptionEncountered': function() {
        
        console.log("Alexa encountered an exception");

        console.dir(this.event.request.error);
        
        this.emit(":responseReady");
    },
    'AMAZON.PauseIntent': function() {

        this.response.speak("")
            .audioPlayerStop();

        this.emit(":responseReady");
    }
};

const audioOutput = '/tmp/sound.m4a';
const mainOutput = '/tmp/output.m4a';

playUrl = function(handler, url) {

    var video = handler.attributes["currentVideo"];

    console.log("Telling alexa to play audio with url " + url);

    handler.response.speak("Now playing " + video.title)
                .audioPlayerPlay("REPLACE_ALL", url, 'myMusic', null, 0);

    handler.emit(':responseReady');
}

function processResult(handler, video) {

    console.log("Processing result");

    handler.attributes["streamUrl"] = null;

    var url = video.id;
    var foundTitle = video.title;
    var playFunction = handler;

    console.log("Process result url is " + url);

    var audioStreamInfo = ytdl.getInfo(url, { filter: function(format) { return format.container === 'm4a'; } }, function (err,info) {

        if (info.formats) {
            
            var format = null;

            for (var i = 0; i < info.formats.length; i++) {

                console.log("Testing format with container type: " + info.formats[i].container);

                if (info.formats[i].container === 'm4a') {

                    format = info.formats[i];

                    break;
                }
            }

            if (format) {

                handler.attributes["streamUrl"] = format.url;

                playUrl(handler, format.url);

                return;
            }
        }

        var contentduration = info.length_seconds;
        video.duration = contentduration;
        
        console.log('Duration is ', contentduration);
        
        var starttime = 0;
        
        console.log ('start secs ', starttime);
        console.log("Donwloading from " + url);

        setTimeout(() => {
            handler.response.speak("Its taking a while to download the audio").listen("Would you like to wait?");

            handler.attributes["downloading"] = true;

            handler.emit(":responseReady");
        }, 5000);
    
        // Write audio to file since ffmpeg supports only one input stream.
        ytdl(
            url, 
            {
                filter: format => {

                    return format.container === 'm4a';  
                } 
            }
        )
        .pipe(fs.createWriteStream(audioOutput))
        .on('finish', () => {
            console.log("Finished downloading from youtube");

            var test = ffmpeg()
            .input(audioOutput)
            .inputFormat('m4a')
            .seekInput(starttime)
            .duration(contentduration)
            .audioCodec('copy')
            .outputOptions('-movflags faststart')
            .save(mainOutput)
            .on('error', console.error)
            .on('end', () => {

                console.log("Copying file.");
                
                fs.copyFileSync(mainOutput, "/tmp/youtube-skill/" + filterTitle(video.title) + ".m4a")

                handler.response.speak("Downloaded " + video.title);

                handler.emit(":responseReady");
            });
        });
    })
};

//
// TODO remove all invalid file name characters
function filterTitle(title) {
    var chars = title.split('');

    var keptChars = [];

    for (var i = 0; i < chars.length; i++) {
        if (chars[i] != '?') {
            keptChars.push(chars[i]);
        }
    }

    return keptChars.join('');
}

var listener = https.createServer(options, app).listen(443, function () {

    console.log('Express HTTPS server listening on port ' + listener.address().port);
});

