import * as Cesium from "cesium";
import { SatelliteComponentCollection } from "./SatelliteComponentCollection";
import { GroundStationEntity } from "./GroundStationEntity";

import { useSatStore } from "../stores/sat";
import { CesiumCleanupHelper } from "./util/CesiumCleanupHelper";

export class SatelliteManager {
  #enabledComponents = ["Point", "Label"];

  #enabledTags = [];

  #enabledSatellites = [];

  #visibleSatellites = {};

  constructor(viewer) {
    this.viewer = viewer;

    this.satellites = [];
    this.availableComponents = ["Point", "Label", "Orbit", "Orbit track", "Ground track", "Sensor cone", "3D model"];

    fetch("../../data/los_vis.json").then((response) => response.json()).then((data) => {
      this.#visibleSatellites = data;
    });

    this.viewer.trackedEntityChanged.addEventListener(() => {
      let checkSatVis;
      if (this.trackedSatellite) {
        this.getSatellite(this.trackedSatellite).show(this.#enabledComponents);
        this.markVisibleSatellite(this.trackedSatellite);
        if (!checkSatVis) {
          checkSatVis = setInterval(() => {
            this.markVisibleSatellites(this.trackedSatellite);
          }, 5000);
        }
      } else {
        if (checkSatVis) {
          clearInterval(checkSatVis);
          checkSatVis = undefined;
        }
        this.getAllEnabledSatellites().forEach((sat) => {
          sat.changeColor(Cesium.Color.WHITE);
        });
      }
      useSatStore().trackedSatellite = this.trackedSatellite;
    });
  }

  addFromTleUrls(urlTagList) {
    // Initiate async download of all TLE URLs and update store afterwards
    const promises = urlTagList.map(([url, tags]) => this.addFromTleUrl(url, tags, false));
    Promise.all(promises).then(() => this.updateStore());
  }

  addFromTleUrl(url, tags, updateStore = true) {
    return fetch(url, {
      mode: "no-cors",
    }).then((response) => {
      if (!response.ok) {
        throw Error(response.statusText);
      }
      return response;
    }).then((response) => response.text())
      .then((data) => {
        const lines = data.split(/\r?\n/);
        for (let i = 3; i < lines.length; i + 3) {
          const tle = lines.splice(i - 3, i).join("\n");
          this.addFromTle(tle, tags, updateStore);
        }
      })
      .catch((error) => {
        console.log(error);
      });
  }

  addFromTle(tle, tags, updateStore = true) {
    const sat = new SatelliteComponentCollection(this.viewer, tle, tags);
    this.#add(sat);
    if (updateStore) {
      this.updateStore();
    }
  }

  #add(newSat) {
    const existingSat = this.satellites.find((sat) => sat.props.satnum === newSat.props.satnum && sat.props.name === newSat.props.name);
    if (existingSat) {
      existingSat.props.addTags(newSat.props.tags);
      if (newSat.props.tags.some((tag) => this.#enabledTags.includes(tag))) {
        existingSat.show(this.#enabledComponents);
      }
      return;
    }
    if (this.groundStationAvailable) {
      newSat.groundStation = this.groundStation.position;
    }
    this.satellites.push(newSat);

    if (this.satIsActive(newSat)) {
      newSat.show(this.#enabledComponents);
      if (this.pendingTrackedSatellite === newSat.props.name) {
        this.trackedSatellite = newSat.props.name;
      }
    }
  }

  updateStore() {
    const satStore = useSatStore();
    satStore.availableTags = this.tags;
    satStore.availableSatellitesByTag = this.taglist;
  }

  get taglist() {
    const taglist = {};
    this.satellites.forEach((sat) => {
      sat.props.tags.forEach((tag) => {
        (taglist[tag] = taglist[tag] || []).push(sat.props.name);
      });
    });
    Object.values(taglist).forEach((tag) => {
      tag.sort();
    });
    return taglist;
  }

  get selectedSatellite() {
    const satellite = this.satellites.find((sat) => sat.isSelected);
    return satellite ? satellite.props.name : "";
  }

  get trackedSatellite() {
    const satellite = this.satellites.find((sat) => sat.isTracked);
    return satellite ? satellite.props.name : "";
  }

  set trackedSatellite(name) {
    if (!name) {
      if (this.trackedSatellite) {
        this.viewer.trackedEntity = undefined;
      }
      return;
    }
    if (name === this.trackedSatellite) {
      return;
    }

    const sat = this.getSatellite(name);
    if (sat) {
      sat.track();
      this.pendingTrackedSatellite = undefined;
    } else {
      // Satellite does not exist (yet?)
      this.pendingTrackedSatellite = name;
    }
  }

  get visibleSatellites() {
    return this.satellites.filter((sat) => sat.created);
  }

  get monitoredSatellites() {
    return this.satellites.filter((sat) => sat.props.pm.active).map((sat) => sat.props.name);
  }

  set monitoredSatellites(sats) {
    this.satellites.forEach((sat) => {
      if (sats.includes(sat.props.name)) {
        sat.props.notifyPasses();
      } else {
        sat.props.pm.clearTimers();
      }
    });
  }

  get satelliteNames() {
    return this.satellites.map((sat) => sat.props.name);
  }

  getSatellite(name) {
    return this.satellites.find((sat) => sat.props.name === name);
  }

  get enabledSatellites() {
    return this.#enabledSatellites;
  }

  set enabledSatellites(newSats) {
    this.#enabledSatellites = newSats;
    this.showEnabledSatellites();

    const satStore = useSatStore();
    satStore.enabledSatellites = newSats;
  }

  get tags() {
    const tags = this.satellites.map((sat) => sat.props.tags);
    return [...new Set([].concat(...tags))];
  }

  getSatellitesWithTag(tag) {
    return this.satellites.filter((sat) => sat.props.hasTag(tag));
  }

  /**
   * Returns true if the satellite is enabled by tag or name
   * @param {SatelliteComponentCollection} sat
   * @returns {boolean} true if the satellite is enabled
   */
  satIsActive(sat) {
    const enabledByTag = this.#enabledTags.some((tag) => sat.props.hasTag(tag));
    const enabledByName = this.#enabledSatellites.includes(sat.props.name);
    return enabledByTag || enabledByName;
  }

  get activeSatellites() {
    return this.satellites.filter((sat) => this.satIsActive(sat));
  }

  showEnabledSatellites() {
    this.satellites.forEach((sat) => {
      if (this.satIsActive(sat)) {
        sat.show(this.#enabledComponents);
      } else {
        sat.hide();
      }
    });
    if (this.visibleSatellites.length === 0) {
      CesiumCleanupHelper.cleanup(this.viewer);
    }
  }

  get enabledTags() {
    return this.#enabledTags;
  }

  set enabledTags(newTags) {
    this.#enabledTags = newTags;
    this.showEnabledSatellites();

    const satStore = useSatStore();
    satStore.enabledTags = newTags;
  }

  get components() {
    const components = this.satellites.map((sat) => sat.components);
    return [...new Set([].concat(...components))];
  }

  get enabledComponents() {
    return this.#enabledComponents;
  }

  set enabledComponents(newComponents) {
    const oldComponents = this.#enabledComponents;
    const add = newComponents.filter((x) => !oldComponents.includes(x));
    const del = oldComponents.filter((x) => !newComponents.includes(x));
    add.forEach((component) => {
      this.enableComponent(component);
    });
    del.forEach((component) => {
      this.disableComponent(component);
    });
  }

  enableComponent(componentName) {
    if (!this.#enabledComponents.includes(componentName)) {
      this.#enabledComponents.push(componentName);
    }

    this.activeSatellites.forEach((sat) => {
      sat.enableComponent(componentName);
    });
  }

  disableComponent(componentName) {
    this.#enabledComponents = this.#enabledComponents.filter((name) => name !== componentName);

    this.activeSatellites.forEach((sat) => {
      sat.disableComponent(componentName);
    });
  }

  get groundStationAvailable() {
    return (typeof this.groundStation !== "undefined");
  }

  focusGroundStation() {
    if (this.groundStationAvailable) {
      this.groundStation.track();
    }
  }

  setGroundStation(position) {
    if (this.groundStationAvailable) {
      this.groundStation.hide();
    }
    if (position.height < 1) {
      position.height = 0;
    }

    // Create groundstation entity
    this.groundStation = new GroundStationEntity(this.viewer, this, position);
    this.groundStation.show();

    // Set groundstation for all satellites
    this.satellites.forEach((sat) => {
      sat.groundStation = this.groundStation.position;
    });

    // Update store for url state
    const satStore = useSatStore();
    satStore.groundstation = [position.latitude, position.longitude];
  }

  getAllEnabledSatellites() {
    return this.satellites.filter((sat) => this.satIsActive(sat));
  }

  markVisibleSatellite(name) {
    // Reset all colors
    this.getAllEnabledSatellites().forEach((sat) => {
      sat.changeColor(Cesium.Color.WHITE);
    });
    // Change the color of the active satellite
    const activeSat = this.getSatellite(name);
    activeSat.changeColor(Cesium.Color.DARKBLUE);
    this.markVisibleSatellites(name);
  }

  markVisibleSatellites(name) {
    // Change the color of the visible satellites
    const visibleSatellites = this.#visibleSatellites[name];
    if (visibleSatellites) {
      Object.keys(visibleSatellites).forEach((satName) => {
        const sat = this.getSatellite(satName);
        let visible = false;
        const timeIntervals = visibleSatellites[satName];
        timeIntervals.forEach((interval) => {
          const { start, end } = interval;
          const { currentTime } = this.viewer.clock;

          const startTimeJulian = Cesium.JulianDate.fromIso8601(start);
          const endTimeJulian = Cesium.JulianDate.fromIso8601(end);

          if (Cesium.JulianDate.greaterThanOrEquals(currentTime, startTimeJulian) && Cesium.JulianDate.lessThanOrEquals(currentTime, endTimeJulian)) {
            visible = true;
          }
        });
        if (visible) {
          console.log("Visible: ", satName);
          if (sat) {
            sat.changeColor(Cesium.Color.GREEN);
          }
        } else if (sat) {
          sat.changeColor(Cesium.Color.WHITE);
        }
      });
    }
  }
}
