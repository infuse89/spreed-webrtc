/*
 * Spreed WebRTC.
 * Copyright (C) 2013-2015 struktur AG
 *
 * This file is part of Spreed WebRTC.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

"use strict";
define(['jquery', 'underscore', 'text!partials/youtubevideo.html', 'text!partials/youtubevideo_sandbox.html', 'bigscreen'], function($, _, template, sandboxTemplate, BigScreen) {

	return ["$window", "$document", "mediaStream", "alertify", "translation", "safeApply", "appData", "$q", function($window, $document, mediaStream, alertify, translation, safeApply, appData, $q) {

		var YOUTUBE_IFRAME_API_URL = "//www.youtube.com/iframe_api";

		var origin = $window.location.protocol + "//" + $window.location.host;

		var Sandbox = function(iframe) {
			this.iframe = iframe;
			var template = sandboxTemplate;
			template = template.replace(/__PARENT__ORIGIN__/g, origin);
			this.iframe.src = "data:text/html;charset=utf-8," + encodeURI(template);
			this.target = this.iframe.contentWindow;
		};

		Sandbox.prototype.postMessage = function(type, message) {
			var msg = {"type": type}
			msg[type] = message;
			this.target.postMessage(msg, "*");
		};

		var SandboxPlayer = function(sandbox, params) {
			this.sandbox = sandbox;
			this.sandbox.postMessage("loadPlayer", params);
		};

		SandboxPlayer.prototype.destroy = function() {
			this.sandbox.postMessage("destroyPlayer", {"destroy": true});
		};

		SandboxPlayer.prototype.loadVideoById = function(id, position) {
			var msg = {"id": id};
			if (typeof(position) !== "undefined") {
				msg.position = position;
			}
			this.sandbox.postMessage("loadVideo", msg);
		};

		SandboxPlayer.prototype.playVideo = function() {
			this.sandbox.postMessage("playVideo", {"play": true});
		};

		SandboxPlayer.prototype.pauseVideo = function() {
			this.sandbox.postMessage("pauseVideo", {"pause": true});
		};

		SandboxPlayer.prototype.stopVideo = function() {
			this.sandbox.postMessage("stopVideo", {"stop": true});
		};

		SandboxPlayer.prototype.seekTo = function(position, allowSeekAhead) {
			var msg = {"position": position};
			if (typeof(allowSeekAhead) !== "undefined") {
				msg.allowSeekAhead = allowSeekAhead;
			}
			this.sandbox.postMessage("seekTo", msg);
		};

		SandboxPlayer.prototype.setVolume = function(volume) {
			this.sandbox.postMessage("setVolume", {"volume": volume});

		};

		SandboxPlayer.prototype.getCurrentTime = function() {
			// TODO(fancycode): implement me
			return 0;
		};

		SandboxPlayer.prototype.getPlayerState = function() {
			// TODO(fancycode): implement me
			return null;
		}

		var controller = ['$scope', '$element', '$attrs', function($scope, $element, $attrs) {

			var addedIframeScript = false;
			var player = null;
			var playerReady = null;
			var isPaused = null;
			var playReceivedNow = null;
			var initialState = null;

			var sandbox = new Sandbox($("#youtubeplayer", $element)[0]);

			var isYouTubeIframeAPIReadyDefer = $q.defer();
			var isYouTubeIframeAPIReady = isYouTubeIframeAPIReadyDefer.promise;

			var onPostMessage = function(event) {
				if (event.origin !== "null" || event.source !== sandbox.target) {
					// the sandboxed data-url iframe has "null" as origin
					return;
				}
				var msg = event.data;
				var data = msg[msg.type] || {};
				switch (msg.type) {
				case "youtube.apiReady":
					$scope.$apply(function() {
						console.log("YouTube IFrame ready");
						isYouTubeIframeAPIReadyDefer.resolve();
					});
					break;
				case "youtube.playerReady":
					$scope.$apply(function() {
						playerReady.resolve();
					});
					break;
				case "youtube.volume":
					$scope.$apply(function(scope) {
						scope.volume = data.volume;
					});
					break;
				case "youtube.event":
					$scope.$apply(function(scope) {
						console.log("State change", data);
						scope.$emit(data.event, data.position);
					});
					break;
				default:
					console.log("Unknown message received", event);
					break;
				}
			};

			$window.addEventListener("message", onPostMessage, false);

			$scope.$on("$destroy", function() {
				$window.removeEventListener("message", onPostMessage, false);
			});

			var errorIds = {
				"2": "invalidParameter",
				"5": "htmlPlayerError",
				"100": "videoNotFound",
				"101": "notAllowedEmbedded",
				"150": "notAllowedEmbedded"
			};

			$scope.isPublisher = null;
			$scope.playbackActive = false;
			$scope.hideControlsBar = true;
			$scope.currentVideoUrl = null;
			$scope.currentVideoId = null;
			$scope.youtubeurl = "";
			$scope.youtubeAPIReady = false;
			$scope.volumebarVisible = true;
			$scope.volume = null;

			isYouTubeIframeAPIReady.then(function() {
				safeApply($scope, function(scope) {
					scope.youtubeAPIReady = true;
				});
			});

			var onPlayerError = function(event) {
				var error = errorIds[event.data] || "unknownError";
				$scope.$apply(function(scope) {
					scope.$emit("youtube.error", error);
				});
			};

			var getYouTubeId = function(url) {
				/*
				 * Supported URLs:
				 * http://www.youtube.com/watch?v=0zM3nApSvMg&feature=feedrec_grec_index
				 * http://www.youtube.com/user/IngridMichaelsonVEVO#p/a/u/1/QdK8U-VIH_o
				 * http://www.youtube.com/v/0zM3nApSvMg?fs=1&amp;hl=en_US&amp;rel=0
				 * http://www.youtube.com/watch?v=0zM3nApSvMg#t=0m10s
				 * http://www.youtube.com/embed/0zM3nApSvMg?rel=0
				 * http://www.youtube.com/watch?v=0zM3nApSvMg
				 * http://youtu.be/0zM3nApSvMg
				 *
				 * Source: http://lasnv.net/foro/839/Javascript_parsear_URL_de_YouTube
				 */
				if (!url) {
					return null;
				}
				var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#\&\?]*).*/;
				var match = url.match(regExp);
				if (match && match[7].length == 11) {
					return match[7];
				}
				return null;
			}

			$scope.$on("youtube.playing", function(event, position) {
				if (initialState === 2) {
					initialState = null;
					player.pauseVideo();
					return;
				}

				if (isPaused) {
					isPaused = false;
					mediaStream.webrtc.callForEachCall(function(peercall) {
						mediaStreamSendYouTubeVideo(peercall, currentToken, {
							Type: "Resume",
							Resume: {
								position: position
							}
						});
					});
				}
			});

			$scope.$on("youtube.buffering", function(event, position) {
				if (initialState === 2) {
					initialState = null;
					player.pauseVideo();
				}
			});

			$scope.$on("youtube.paused", function(event, position) {
				if (!$scope.isPublisher || !currentToken) {
					return;
				}

				if (!isPaused) {
					isPaused = true;
					mediaStream.webrtc.callForEachCall(function(peercall) {
						mediaStreamSendYouTubeVideo(peercall, currentToken, {
							Type: "Pause",
							Pause: {
								position: position
							}
						});
					});
				}
			});

			$scope.$on("youtube.ended", function() {
			});

			$scope.$on("youtube.seeked", function($event, position) {
				if (!$scope.isPublisher || !currentToken) {
					return;
				}

				mediaStream.webrtc.callForEachCall(function(peercall) {
					mediaStreamSendYouTubeVideo(peercall, currentToken, {
						Type: "Seek",
						Seek: {
							position: position
						}
					});
				});
			});

			var playVideo = function(id, position, state) {
				playerReady.done(function() {
					$("#youtubeplayer").show();
					$scope.playbackActive = true;
					isPaused = null;
					if (playReceivedNow) {
						var delta = ((new Date()) - playReceivedNow) * 0.001;
						playReceivedNow = null;
						if (position) {
							position += delta;
						} else {
							position = delta;
						}
					}
					initialState = state;
					if (position) {
						player.loadVideoById(id, position);
					} else {
						player.loadVideoById(id);
					}
				});
			};

			var createVideoPlayer = function(with_controls) {
				if (player && $scope.isPublisher !== with_controls) {
					player.destroy();
					player = null;
					playerReady = null;
				}

				if (!playerReady) {
					playerReady = $.Deferred();
				}

				isYouTubeIframeAPIReady.then(function() {
					if (!player) {
						var origin = $window.location.protocol + "//" + $window.location.host;
						player = new SandboxPlayer(sandbox, {
							height: "390",
							width: "640",
							playerVars: {
								"enablejsapi": "1",
								"hl": appData.language || "en",
								"autohide": "1",  // hide all controls on playback
								"rel": "0",  // don't show related videos on end
								"showinfo": "0",  // don't show title/uploader before start
								"playsinline": "1",  // play inline on iOS if possible
								"controls": with_controls ? "2" : "0",
								"disablekb": with_controls ? "0" : "1",
								"origin": origin
							}
						});
						$("#youtubeplayer").show();
						safeApply($scope, function(scope) {
							// YT player events don't fire in Firefox if
							// player is not visible, so show while loading
							scope.playbackActive = true;
							scope.isPublisher = with_controls;
						});
					}
				});
			};

			$scope.shareVideo = function(url) {
				var id = getYouTubeId(url);
				if (!id) {
					alertify.dialog.alert(translation._("Unknown URL format. Please make sure to enter a valid YouTube URL."));
					return;
				}

				mediaStream.webrtc.callForEachCall(function(peercall) {
					mediaStreamSendYouTubeVideo(peercall, currentToken, {
						Type: "Play",
						Play: {
							"url": url,
							"id": id
						}
					});
				});

				createVideoPlayer(true);
				$scope.youtubeurl = "";
				$scope.currentVideoUrl = url;
				$scope.currentVideoId = id;
				playVideo(id);
			};

			mediaStream.api.e.on("received.youtubevideo", function(event, id, from, data, p2p) {
				if (!p2p) {
					console.warn("Received YouTubeVideo info without p2p. This should not happen!");
					return;
				}

				if (data.Type) {
					switch (data.Type) {
					case "Show":
						console.log("Received YouTubeVideo show request", data);
						$scope.$apply(function(scope) {
							scope.layout.youtubevideo = true;
						});
						break;

					case "Hide":
						console.log("Received YouTubeVideo hide request", data);
						$scope.$apply(function(scope) {
							scope.layout.youtubevideo = false;
						});
						break;

					case "Play":
						console.log("Received YouTubeVideo play request", data);
						playReceivedNow = new Date();
						$scope.$apply(function(scope) {
							scope.currentVideoUrl = data.Play.url;
							createVideoPlayer(false);
							playerReady.done(function() {
								safeApply(scope, function(scope) {
									scope.currentVideoUrl = data.Play.url;
									scope.currentVideoId = data.Play.id;
									playVideo(data.Play.id, data.Play.position, data.Play.state);
								});
							});
						});
						break;

					case "Pause":
						console.log("Received YouTubeVideo pause request", data);
						$scope.$apply(function(scope) {
							if (player) {
								player.pauseVideo();
								if (data.Pause.position) {
									player.seekTo(data.Pause.position, true);
								}
							}
						});
						break;

					case "Resume":
						console.log("Received YouTubeVideo resume request", data);
						$scope.$apply(function(scope) {
							if (player) {
								if (data.Resume.position) {
									player.seekTo(data.Resume.position, true);
								}
								player.playVideo();
							}
						});
						break;

					case "Seek":
						console.log("Received YouTubeVideo seek request", data);
						$scope.$apply(function(scope) {
							if (player) {
								player.seekTo(data.Seek.position);
							}
						});
						break;

					default:
						console.log("Received unknown YouTubeVideo event", data);
					}
				}
			});

			var peers = {};
			var youtubevideos = [];
			var youtubevideoCount = 0;
			var currentToken = null;
			var tokenHandler = null;

			var mediaStreamSendYouTubeVideo = function(peercall, token, params) {
				mediaStream.api.apply("sendYouTubeVideo", {
					send: function(type, data) {
						if (!peercall.peerconnection.datachannelReady) {
							return peercall.e.one("dataReady", function() {
								peercall.peerconnection.send(data);
							});
						} else {
							return peercall.peerconnection.send(data);
						}
					}
				})(peercall.id, token, params);
			};

			var connector = function(token, peercall) {
				if (peers.hasOwnProperty(peercall.id)) {
					// Already got a connection.
					return;
				}
				peers[peercall.id] = true;
				mediaStreamSendYouTubeVideo(peercall, token, {
					Type: "Show",
					Show: true
				});
				if ($scope.isPublisher && $scope.currentVideoUrl) {
					var playInfo = {
						url: $scope.currentVideoUrl,
						id: $scope.currentVideoId
					};
					if (player) {
						playInfo.position = player.getCurrentTime();
						playInfo.state = player.getPlayerState();
					}
					mediaStreamSendYouTubeVideo(peercall, token, {
						Type: "Play",
						Play: playInfo
					});
				}
			};

			// Updater function to bring in new calls.
			var updater = function(event, state, currentcall) {
				switch (state) {
					case "completed":
					case "connected":
						connector(currentToken, currentcall);
						break;
					case "closed":
						delete peers[currentcall.id];
						if (_.isEmpty(peers)) {
							console.log("All peers disconnected, stopping youtubevideo");
							$scope.$apply(function(scope) {
								scope.hideYouTubeVideo();
							});
						}
						break;
				}
			};

			$scope.loadYouTubeAPI = function() {
				sandbox.postMessage("loadApi", {"url": $window.location.protocol + YOUTUBE_IFRAME_API_URL});
			};

			$scope.showYouTubeVideo = function() {
				$scope.loadYouTubeAPI();
				$scope.layout.youtubevideo = true;
				$scope.$emit("mainview", "youtubevideo", true);
				if (currentToken) {
					mediaStream.tokens.off(currentToken, tokenHandler);
				}

				// Create token to register with us and send token out to all peers.
				// Peers when connect to us with the token and we answer.
				currentToken = "youtubevideo_" + $scope.id + "_" + (youtubevideoCount++);

				// Create callbacks are called for each incoming connections.
				tokenHandler = mediaStream.tokens.create(currentToken, function(event, currenttoken, to, data, type, to2, from, peer) {
					console.log("YouTubeVideo create", currenttoken, data, type, peer);
					youtubevideos.push(peer);
				}, "youtubevideo");

				// Connect all current calls.
				mediaStream.webrtc.callForEachCall(function(peercall) {
					connector(currentToken, peercall);
				});
				// Catch later calls too.
				mediaStream.webrtc.e.on("statechange", updater);
			};

			$scope.hideYouTubeVideo = function() {
				$scope.$emit("mainview", "youtubevideo", false);
				$scope.layout.youtubevideo = false;
				if (currentToken) {
					mediaStream.webrtc.callForEachCall(function(peercall) {
						mediaStreamSendYouTubeVideo(peercall, currentToken, {
							Type: "Hide",
							Hide: true
						});
					});
					mediaStream.tokens.off(currentToken, tokenHandler);
					currentToken = null;
				}
				if (player) {
					player.destroy();
					player = null;
				}
				$scope.isPublisher = null;
				$scope.playbackActive = false;
				$scope.currentVideoUrl = null;
				$scope.currentVideoId = null;
				peers = {};
				playerReady = null;
				initialState = null;
				mediaStream.webrtc.e.off("statechange", updater);
			};

			$scope.$watch("layout.youtubevideo", function(newval, oldval) {
				if (newval && !oldval) {
					$scope.showYouTubeVideo();
				} else if (!newval && oldval) {
					$scope.hideYouTubeVideo();
				}
			});

			$scope.$watch("layout.main", function(newval, oldval) {
				if (newval && newval !== "youtubevideo") {
					$scope.hideYouTubeVideo();
				}
			});

			$scope.$watch("volume", function(newval, oldval) {
				// allow "viewers" to change the volume manually
				if (oldval !== newval && player && !$scope.isPublisher && newval !== null) {
					player.setVolume(newval);
				}
			});

			$scope.toggleFullscreen = function(elem) {

				if (BigScreen.enabled) {
					BigScreen.toggle(elem);
				}

			};

		}];

		var compile = function(tElement, tAttr) {
			return function(scope, iElement, iAttrs, controller) {
				$(iElement).find("#youtubecontainer").on("dblclick", _.debounce(function(event) {
					scope.toggleFullscreen(event.delegateTarget);
				}, 100, true));
			}
		};

		return {
			restrict: 'E',
			replace: true,
			scope: true,
			template: template,
			controller: controller,
			compile: compile
		};

	}];

});
